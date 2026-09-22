# 第三方组件与素材

整理日期：2026-09-19。

Logo、入口插画、像素头像、游戏素材来自用户提供的工程，权利归原权利人。本次没有重新生成或修改原始图像内容；入口内嵌素材已按内容摘要外置保存。

中文字体：项目支持 Noto Sans SC / Noto CJK 等兼容字体。GitHub 源码版不打包字体二进制；`server/fonts/OFL.txt` 仅保留 SIL Open Font License 参考。需要 PDF 中文导出时，请通过 `PDF_FONT` 指定本机字体或安装系统字体。Noto Sans SC 官方来源：https://github.com/google/fonts/tree/main/ofl/notosanssc 。

运行依赖包括 OpenHex Agent SDK、Express、Multer、docx、ExcelJS、Mammoth、pdf-parse、PDFKit、fontkit、PptxGenJS、JSZip、qrcode。确切版本和完整性值见 package.json 与 package-lock.json；安装后各包许可证按其原文执行。包中不分发 node_modules。

手势入口使用 MediaPipe Hands CDN。脚本和模型需要网络访问；加载失败会提示切换密码入口。插件品牌图标来源见 `docs/plugin-icon-sources.md`。保留第三方来源和许可证不代表获得额外商业授权。


> 许可边界：根目录 `LICENSE` 主要覆盖项目源代码；媒体、品牌、字体与第三方资产不因存在于仓库而自动获得 Apache-2.0 许可。详见 `ASSETS_LICENSE.md`。
