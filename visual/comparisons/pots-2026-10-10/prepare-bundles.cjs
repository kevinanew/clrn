const { execFileSync } = require('node:child_process');
const { mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const repository = process.env.COMPARISON_CLIENT_REPOSITORY;
if (!repository) throw new Error('请设置 COMPARISON_CLIENT_REPOSITORY，指向来玩客户端仓库。');
const dependencyDirectory = process.env.COMPARISON_DEPENDENCY_DIRECTORY || path.join(repository, 'node_modules');
const babel = require(path.join(dependencyDirectory, '@babel/core'));
const directory = path.join(__dirname, '.prepared-bundles');
const previousRevision = '5d415f480^';
const componentPath = 'src/texas_holdem_react_native/main/component/pots/Pots.js';
const stylePath = 'src/texas_holdem_react_native/main/component/pots/resource/style/PotsStyle.js';

/**
 * 从 Git 读取修改前真实源码，不触碰客户端工作区。
 * @param filename - 客户端仓库内的源码相对路径。
 */
function readPreviousSource(filename) {
  return execFileSync('git', ['show', `${previousRevision}:${filename}`], { cwd: repository, encoding: 'utf8' });
}

/** 下载当前部署入口并保存哈希，固定两版的其他应用代码。 */
async function main() {
  mkdirSync(directory, { recursive: true });
  const baseUrl = 'https://h5.page.shafayouxi.org/';
  const entry = await fetch(baseUrl);
  if (!entry.ok) throw new Error('无法下载 staging 入口。');
  const scriptMatch = (await entry.text()).match(/<script[^>]*src="([^"]*\/_expo\/static\/js\/web\/index-[^"]+)"/);
  if (!scriptMatch) throw new Error('staging 入口缺少预期的 Expo 应用包。');
  const scriptPath = scriptMatch[1];
  const response = await fetch(new URL(scriptPath, baseUrl));
  if (!response.ok) throw new Error('无法下载 staging 应用包。');
  const currentBundle = await response.text();
  const lines = currentBundle.split('\n');
  const componentIndex = lines.findIndex(line => line.includes('texas_holdem_side_pots_list'));
  const styleIndex = lines.findIndex(line => line.includes('sidePotsList:{'));
  // 模块编号绑定本次部署；部署变化时明确失败，避免错误替换其他组件。
  if (!lines[componentIndex]?.endsWith('},4331,[1,5,151,161,19,4167,4332,183,4333,2391]);')) {
    throw new Error('当前部署的底池模块编号已变化，需要重新核对模块依赖。');
  }
  if (!lines[styleIndex]?.includes("sidePotsList:{width:200,flexDirection:'row',flexWrap:'wrap'")) {
    throw new Error('当前部署的底池样式与预期不符。');
  }
  const previousComponent = readPreviousSource(componentPath);
  const previousStyle = readPreviousSource(stylePath);
  const component = previousComponent.replace(/^import .*;\n/gm, '')
    .replace("const iconPotGold = require('./resource/image/img_pot_gold.png');", 'const iconPotGold = require(4333);')
    .replace('export default class Pots', 'exports.default = class Pots');
  const imports = 'const React = require(5); const PureComponent = React.PureComponent; const CurrencyFormatter = require(2391).CurrencyFormatter; const FlatList = require(17).default; const Image = require(151).default; const Text = require(161).default; const View = require(19).default; const I18N = require(4167).default; const styles = require(4332).default;';
  const compiled = babel.transformSync(imports + component, { configFile: false, babelrc: false,
    plugins: [path.join(dependencyDirectory, '@babel/plugin-transform-react-jsx')], compact: true }).code;
  lines[componentIndex] = `__d(function(global,require,importDefault,importAll,module,exports,dependencyMap){Object.defineProperty(exports,"__esModule",{value:true});${compiled}},4331,[]);`;
  // 同一提交还改变了边池列表方向，比较时同步恢复旧样式。
  lines[styleIndex] = lines[styleIndex].replace("sidePotsList:{width:200,flexDirection:'row',flexWrap:'wrap'", "sidePotsList:{width:200,flexWrap:'wrap'");
  writeFileSync(path.join(directory, 'current.js'), currentBundle);
  writeFileSync(path.join(directory, 'previous.js'), lines.join('\n'));
  writeFileSync(path.join(directory, 'previous-Pots.js'), previousComponent);
  writeFileSync(path.join(directory, 'previous-PotsStyle.js'), previousStyle);
  const previousCommit = execFileSync('git', ['rev-parse', previousRevision], { cwd: repository, encoding: 'utf8' }).trim();
  writeFileSync(path.join(__dirname, 'provenance.json'), JSON.stringify({ baseUrl, scriptPath, previousCommit,
    currentBundleSha256: createHash('sha256').update(currentBundle).digest('hex'),
    changedModules: [componentPath, stylePath], capturedPlatform: process.platform,
    fullTablePots: [90, 80, 70, 60, 50, 40, 30, 20, 10], capturedAt: new Date().toISOString() }, null, 2));
  console.log('已准备两版底池组件；其余线上应用代码完全一致。');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
