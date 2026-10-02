# 第三方依赖与许可来源核对

核对日期：2026-10-01。此清单记录软件包自身元数据和随包许可正文，不决定本项目的著作权归属，也不为本项目授予开源许可。仓库未新增顶层 LICENSE。漏洞审计通过不等于许可审查通过。

运行依赖参考版本来自 `evidence/dependency-audit-current.json` 的20项解析快照；开发工具版本来自 `requirements-dev.txt` 与 `package-lock.json`。安装包版本相符时，原样保存其 dist-info 许可文件（TypeScript另保留ThirdPartyNoticeText），路径及SHA-256见 [机器可核对清单](third-party-inventory.json)。这里只保存许可/告知文本，不打包依赖源码、二进制或字体。

|软件包|参考版本|本地安装版本|本地元数据许可|参考版本正文核对|
|---|---|---|---|---|
|fastapi|0.141.1|0.141.1|MIT|已留存1份原文|
|uvicorn|0.48.0|0.48.0|BSD-3-Clause|已留存1份原文|
|pydantic|2.13.4|2.13.4|MIT|已留存1份原文|
|python-multipart|0.0.32|0.0.32|Apache-2.0|已留存1份原文|
|openpyxl|3.1.5|3.1.5|MIT|已留存1份原文|
|starlette|1.3.1|1.3.1|BSD-3-Clause|已留存1份原文|
|defusedxml|0.7.1|0.7.1|PSFL|已留存1份原文|
|cryptography|50.0.1|50.0.1|Apache-2.0 OR BSD-3-Clause|已留存3份原文|
|pydantic-core|2.46.4|2.46.4|MIT|已留存1份原文|
|anyio|4.15.1|4.14.2|MIT|待核对该参考版本；不能用本地不同版本替代|
|annotated-doc|0.0.5|0.0.5|MIT|已留存1份原文|
|annotated-types|0.8.0|0.8.0|MIT|已留存1份原文|
|cffi|2.1.1|2.1.1|MIT-0|已留存1份原文|
|click|8.5.0|8.4.2|BSD-3-Clause|待核对该参考版本；不能用本地不同版本替代|
|h11|0.16.0|0.16.0|MIT|已留存1份原文|
|idna|3.20|3.18|BSD-3-Clause|待核对该参考版本；不能用本地不同版本替代|
|typing-extensions|4.16.0|4.16.0|PSF-2.0|已留存1份原文|
|typing-inspection|0.4.4|0.4.3|MIT|待核对该参考版本；不能用本地不同版本替代|
|et-xmlfile|2.0.0|2.0.0|MIT|已留存2份原文|
|pycparser|3.0|3.0|BSD-3-Clause|已留存1份原文|
|pytest|9.0.2|9.0.2|MIT|已留存1份原文|
|httpx|0.28.1|0.28.1|BSD-3-Clause|已留存1份原文|
|playwright|1.57.0|1.57.0|Apache-2.0|已留存1份原文|
|pytest-cov|7.0.0|7.0.0|MIT|已留存2份原文|
|typescript|5.8.3|5.8.3|Apache-2.0|已留存2份原文|

## 尚需核对的边界

- requirements.txt仅锁定直接依赖；Python解析依赖会随安装时间变化，现有审计JSON不是完整可重现锁文件。anyio、click、idna、typing-inspection的本地版本与审计快照不同，表中许可只描述本地元数据，未据此认证审计版本
- pypdf是未安装验证的可选路径（requirements-pdf.txt），未纳入此清单的许可正文核对；启用前须针对实际安装版本留存许可及依赖
- 开发工具的完整传递依赖、Playwright下载的浏览器及其内嵌组件、操作系统和Python解释器等不在此表的完整性承诺内；打包这些组件前另行盘点，不把工具自身许可当成浏览器全部许可
- 若将来发布包含依赖的安装包或二进制，按实际包含内容复核上游许可、版权告知、内嵌组件和分发要求；本次仅为来源记录，不是法律意见或无侵权证明
- Logo与MP4的原始摘要可证明字节保留，不能证明素材或视频内所有元素的使用授权；登记材料还需来源与授权依据
