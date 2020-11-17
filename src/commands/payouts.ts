import * as fs from 'fs'
import {Command, flags} from '@oclif/command'
import gql from 'graphql-tag'
import {request} from 'graphql-request'
import Big from 'big.js'
import {ethers} from 'ethers'

interface Token {
	symbol: string;
}

interface Pair {
	reserve0: string;
	token0: Token;
	reserve1: string;
	token1: Token;
}

interface LP {
	liquidityTokenBalance: string;
	user: User;
	pair: Pair;
}

interface User {
	id: string;
}

interface State {
	start_block: number;
	end_block: number;
	current: number;
	totals: Map<string, ethers.BigNumber>;
}

function stateFileExists(): boolean {
	try {
		if (fs.existsSync('.state.json'))
			return true;
	} catch (err) {
		console.error(`checking for state file: ${err}`)
		return false
	}
	return false
}

function readState(): State {
	try {
		let t = JSON.parse(fs.readFileSync('.state.json', 'utf8'))
		let ret: State = {
			start_block: t.start_block,
			end_block: t.end_block,
			current: t.current,
			totals: new Map(t.totals.map(([k, v]: [string, string]) => { return [ k, ethers.BigNumber.from(v) ] }))
		}
		return ret
	} catch (err) {
		throw err
	}
}

function writeState(s: State): void | Error {
	let out = {
		start_block: s.start_block,
		end_block: s.end_block,
		current: s.current,
		totals: Array.from(s.totals.entries(), ([k, v]) => { return [k, v.toString()] })
	}
	try {
		fs.writeFileSync(
			'.state.json',
			JSON.stringify(out),
			//{ flag: 'w+' }
		);
	} catch (err) {
		return err
	}

}

function mkBatch(from: number, to: number, pair: string) {
	let q = "query blocks {"
	for (let i = from; i < to; i++) {
		q += `
		t${i}:liquidityPositions(
			where: {
				liquidityTokenBalance_gt: 0,
				pair: "${pair}",
			},
			orderBy: liquidityTokenBalance,
			orderDirection: desc,
			block: { number: ${i} },	
		) {
			user { id }
			pair {
				reserve0
				token0 { symbol }
				reserve1
				token1 { symbol }
			}
			liquidityTokenBalance
		}
		`
	}
	q += "}"

	return gql(q)
}

interface Block {
	positions: Position[];
	totalUTU: ethers.BigNumber;
}

interface Position {
	address: string;
	amount: ethers.BigNumber; // In UTU
}

/// Take a batch of liquidity positions and a set of addresses to exclude and
/// convert the liquidity tokens into UTU to be able to compare them better
/// across the WETH and USDC pools.
function extractLPs(batch: Map<string, LP[][]>, exclude: Set<string>): Map<number, Block> {
	let rs: Map<number, Block> = new Map()
	for (let [k, ret] of Object.entries(batch)) {
		let block: number = +k.substr(1)
		if (ret.length < 1) {
			rs.set(block, {positions: [], totalUTU: ethers.constants.Zero})
			continue
		}

		// Filter liquidity provided by UTU itself
		let lps = ret.filter((p: LP) => { return !exclude.has(p.user.id.toLowerCase()) })
		// And then add up the rest as new total
		let totalEx: ethers.BigNumber = lps.reduce((acc: ethers.BigNumber, c: any) => {
			return acc.add(ethers.utils.parseEther(c.liquidityTokenBalance))
		}, ethers.constants.Zero)
		let total: ethers.BigNumber = ret.reduce((acc: ethers.BigNumber, c: any) => {
			return acc.add(ethers.utils.parseEther(c.liquidityTokenBalance))
		}, ethers.constants.Zero)

		let totalUTU: ethers.BigNumber
		// Check which pair is UTU
		if (ret[0].pair.token0.symbol === "UTU") {
			totalUTU = ethers.utils.parseEther(ret[0].pair.reserve0)
		} else {
			totalUTU = ethers.utils.parseEther(ret[0].pair.reserve1)
		}

		let utuPerLPShare = totalUTU.div(total)
		let ps: Position[] = lps.map((p: LP) => {
			return {address: p.user.id, amount: ethers.utils.parseEther(p.liquidityTokenBalance).mul(utuPerLPShare) }
		})
		rs.set(block, {positions: ps, totalUTU: utuPerLPShare.mul(totalEx)})

	}

	return rs
}

// Merge the UTU positions of the two pools (WETH and USDC) to make splitting
// the rewards easier
function mergeLPs(fst: Map<number, Block>, snd: Map<number, Block>): Map<number, Block> {
	const ret = new Map(fst)

	snd.forEach((p: Block, k: number) => {
		if (ret.has(k)) {
			let block = ret.get(k) ?? {positions: [], totalUTU: ethers.constants.Zero}
			ret.set(k, {positions: block.positions.concat(p.positions), totalUTU: block.totalUTU.add(p.totalUTU)})
		} else {
			ret.set(k, p)
		}
	})

	return ret
}


export default class Payouts extends Command {
	static description = 'compute payouts'

  static examples = [
    `$ liquidity 11162654 11169200`,
  ]

	static flags = {
		continue: flags.boolean({char: 'c'}),
	}

	static args = [
		{
			name: 'start_block',
			//required: true,
			default: 11162654,
		},
		{
			name: 'end_block',
			//required: true,
			default: 0,
		}
	]

	async run() {
		const {args, flags} = this.parse(Payouts)

		let end_block = +args.end_block
		let start_block = +args.start_block

		const UTUETH = "0x8d01c6e109c3db63f7aa43404157b274cf18ffd8"
		const UTUETHStart = 11162654
		const UTUUSDC = "0x34bc4e6b6997af1cf66e7899849bd3e288827890"
		const UTUUSDCStart = 11205795
		let exclude: Set<string> = new Set(["0x6510a1e08c721f379cf8f0f7c62f6ee640ed8a9c", "0xc92dc01a1fa6fa597c627f497e899c29df3b986b"])

		let state: State
		if (flags.continue) {
			this.log(`picking up from saved state in .state.json`)
			if(stateFileExists()) {
				state = readState()
			} else {
				this.error(`no .state.json found`)
				this.exit(1)
			}
		} else {
			if (start_block < UTUETHStart) {
				this.error(`liquidity incentives started at block #${UTUETHStart}`)
				this.exit(1)
			} 
			if (end_block <= start_block) {
				this.error(`end <= start`)
				this.exit(1)
			}

			state = {
				start_block: start_block,
				end_block: end_block,
				current: start_block,
				totals: new Map()
			}
		}

		let batchSize = 100
		let totals: Map<string, Big> = new Map()

		for (let i: number = state.current;;) {
			if (i >= state.end_block) { break }
			let positions: Map<string, Big> = new Map()
			let to = Math.min(i + batchSize, state.end_block)

			// ETH
			let query = mkBatch(i, to, UTUETH)
			let batch: Map<string, LP[][]> = await request('https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v2', query)
			let lps = extractLPs(batch, exclude)

			if (to > UTUUSDCStart) {
				let start = Math.max(i, UTUUSDCStart)
				console.log(`USDC ${start}`)
				query = mkBatch(i, to, UTUUSDC)
				console.log(`USDC ${query}`)
				batch = await request('https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v2', query)
				console.log(batch)

				lps = mergeLPs(lps, extractLPs(batch, exclude))
			}

			this.log(`batch ${i} to ${to} (target ${state.end_block})`)

			// Iterate over blocks and assign the rewards
			for (let [k, ps] of lps) {
				let tu = new Big(ethers.utils.formatEther(ps.totalUTU))

				// Every blocks we calculate the rewards per UTU of liquidy provided
				let utuPerUTU = (new Big(15)).div(ethers.utils.formatEther(ps.totalUTU))

				//let t: Big = new Big(0)
				for (let p of ps.positions) {
					let reward = (new Big(ethers.utils.formatEther(p.amount))).mul(utuPerUTU).toFixed(18)
					//t = t.add(reward)
					let t = state.totals.get(p.address) ?? ethers.constants.Zero
					state.totals.set(p.address, t.add(ethers.utils.parseEther(reward)))
				}
				// XXX: diff between actual and 15 goes to random LP?
				//this.log(`Total: ${t}`)
			}

			// XXX: Handle retries
			state.current = to
			if (writeState(state)) {
				this.warn(`could not write state; trying again`)
				continue
			}

			i = i + batchSize > state.end_block ? state.end_block : i + batchSize
		}

		this.log(`Writing output.json`)
		let t = ethers.constants.Zero
		let out: {[key: string]: string} = {}
		for (let [addr, amount] of state.totals) {
			this.log(`${addr} receives ${ethers.utils.formatEther(amount)}`)
			t = t.add(amount)
			out[addr] = ethers.utils.formatEther(amount)
		}
		fs.writeFileSync('output.json', JSON.stringify(out))

		console.log(`Total: ${ethers.utils.formatEther(t)}. Average ${ethers.utils.formatEther(t.div(state.end_block - state.start_block))} UTU per block`)
	}
}

