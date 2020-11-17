import {Command, flags} from '@oclif/command'
import gql from 'graphql-tag'
import {request} from 'graphql-request'
import {Big} from 'big.js'

export default class CurrentLiquidty extends Command {
	static description = 'liquidity provided'

	static flags = {}

	static args = []

	async run() {
		const {args, flags} = this.parse(CurrentLiquidty)

		const UTUETH = "0x8d01c6e109c3db63f7aa43404157b274cf18ffd8"
		const UTUUSDC = "0x34bc4e6b6997af1cf66e7899849bd3e288827890"
		let exclude: Set<string> = new Set(["0x6510a1e08c721f379cf8f0f7c62f6ee640ed8a9c", "0xc92dc01a1fa6fa597c627f497e899c29df3b986b"])

		const currLiqQ = gql(`{
			eth_pair:pair(id: "${UTUETH}") {
				id
				reserve0
				reserve1
				token0 {
					id
					symbol
					derivedETH
				}
				token1 {
					id
					symbol
					derivedETH
				}
				totalSupply
			}
			usdc_pair:pair(id: "${UTUUSDC}") {
				id
				reserve0
				reserve1
				token0 {
					id
					symbol
					derivedETH
				}
				token1 {
					id
					symbol
					derivedETH
				}
				totalSupply
			}
			eth_lp:liquidityPositions(where: {
				user_in: ["0x6510a1e08c721f379cf8f0f7c62f6ee640ed8a9c", "0xc92dc01a1fa6fa597c627f497e899c29df3b986b"],
				pair: "${UTUETH}"
			}) {
				liquidityTokenBalance
			}
			usdc_lp:liquidityPositions(where: {
				user_in: ["0x6510a1e08c721f379cf8f0f7c62f6ee640ed8a9c", "0xc92dc01a1fa6fa597c627f497e899c29df3b986b"],
				pair: "${UTUUSDC}"
			}) {
				liquidityTokenBalance
			}
		}`)

		const liq = await request('https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v2', currLiqQ)

		let exETHLPLiq = liq.eth_lp.reduce(
			(acc: Big, c: any) => {
				return acc.add(new Big(c.liquidityTokenBalance))
			}, new Big(0))
		let exUSDCLPLiq = liq.usdc_lp.reduce(
			(acc: Big, c: any) => {
				return acc.add(new Big(c.liquidityTokenBalance))
			}, new Big(0))
		let totalETHLP = new Big(liq.eth_pair.totalSupply)
		let totalUSDCLP = new Big(liq.usdc_pair.totalSupply)

		let ethR0 = new Big(liq.eth_pair.reserve0)
		let utuPerLPShare = ethR0.div(totalETHLP)
		let ethR1 = new Big(liq.eth_pair.reserve1)
		let ethPerLPShare = ethR1.div(totalETHLP)
		this.log(`total liquidity UTU/WETH ${ethR0} UTU / ${ethR1} WETH`)
		this.log(`adjusted liquidity UTU/WETH ${utuPerLPShare.mul(totalETHLP.sub(exETHLPLiq))} UTU / ${ethPerLPShare.mul(totalETHLP.sub(exETHLPLiq))} WETH`)

		let usdcR0 = new Big(liq.usdc_pair.reserve0)
		let usdcPerUSDCLPShare = usdcR0.div(totalUSDCLP)
		let usdcR1 = new Big(liq.usdc_pair.reserve1)
		let utuPerUSDCLPShare = usdcR1.div(totalUSDCLP)
		this.log(`total liquidity ${usdcR1} UTU / ${usdcR0} USDC`)
		this.log(`adjusted liquidity ${utuPerUSDCLPShare.mul(totalUSDCLP.sub(exUSDCLPLiq))} UTU / ${usdcPerUSDCLPShare.mul(totalUSDCLP.sub(exUSDCLPLiq))} USDC`)
	}
}

