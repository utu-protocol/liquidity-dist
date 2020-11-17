liquidity
=========

UTU liquidity rewards

[![Version](https://img.shields.io/npm/v/liquidity.svg)](https://npmjs.org/package/liquidity)
[![License](https://img.shields.io/npm/l/liquidity.svg)](https://github.com/utu-protocol/liquidity/blob/master/package.json)

# Usage
<!-- usage -->
```sh-session
$ npm install
$ ./bin/run COMMAND
running command...
$ liquidity (-v|--version|version)
liquidity/0.1.0 darwin-x64 node-v12.18.4
$ liquidity --help [COMMAND]
...
```
<!-- usagestop -->
# Commands
<!-- commands -->

## `liquidity current`

Display the currently provided liquidity excluding UTU and partners.

```sh-session
$ ./bin/run current
total liquidity UTU/WETH 11036731.950898090112524873 UTU / 124.974417560987749295 WETH
adjusted liquidity UTU/WETH 3034782.2814750335656805621981939682324496516 UTU / 34.364352576387942115347937043336153371 WETH
total liquidity 1618490.326863284949957729 UTU / 8535.372508 USDC
adjusted liquidity 1618490.3268632849499577289995694226555936918 UTU / 8535.37250799999999999999975375199592539692 USDC
```

_See code: [src/commands/current.ts](https://github.com/utu-protocol/liquidity/blob/v0.1.0/src/commands/current.ts)_

## `liquidity payouts [START_BLOCK] [END_BLOCK]`

Calculates the rewards for the period between `start_block` and `end_block`.

```sh-session
$ ./bin/run payouts 11162654 11169200
batch 11162654 to 11162754 (target 11169200)
batch 11162754 to 11162854 (target 11169200)
...
```

Will write the final results to `output.json` and keep intermediate state in
`.state.json`.

```sh-session
$ ./bin/run payouts -c
picking up from saved state in .state.json
```
