// 明确告知 electron renderer 子项目不使用 tailwind / 任何 postcss 插件，
// 防止 vite 沿父目录搜索到根目录 postcss.config.js 触发 tailwind content 警告。
module.exports = {
  plugins: {},
}
