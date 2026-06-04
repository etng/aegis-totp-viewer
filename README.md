# Aegis TOTP Viewer

一个本地使用的 Aegis 备份查看器。你可以打开从 Aegis 导出的 JSON 备份，在浏览器里查看一次性验证码。

- 支持加密或明文 Aegis JSON 备份
- 展示服务名、账户名、分组、备注和常用标记
- 解密和验证码计算都在本地完成
- 默认只刷新当前选中的条目，列表多的时候也更安静
- 提供网页版和浏览器插件版

## 在线使用

打开 GitHub Pages 在线版后，选择或拖入你的 Aegis JSON 备份，输入备份密码即可查看验证码。

在线版地址：https://etng.github.io/aegis-totp-viewer/

所有数据都只在当前页面内存中处理。刷新页面或点击「锁定」会清空当前解锁状态。

## 下载插件

在 Releases 页面下载最新版浏览器插件包：

下载地址：https://github.com/etng/aegis-totp-viewer/releases

- Chrome / Chromium：下载 Chrome zip
- Firefox：下载 Firefox zip

安装方式以浏览器当前说明为准。安装后，可以从浏览器工具栏快速打开。

## 使用建议

- 建议从 Aegis 导出加密备份。
- 不要把明文备份放到公开位置。
- 使用完点击「锁定」，或直接关闭页面。
- 如果你觉得这个工具有帮助，欢迎给仓库点 Star。

## 发布版本

项目使用 SemVer 版本号。带有 `vX.Y.Z` 格式的 tag 会触发自动打包，并在 GitHub Release 中附上插件包和网页版产物。
