# 依赖与构建环境

核心依赖固定本次实测版本，不称最新版本或零漏洞。原有TypeScript5.9.3联网安装未成功，最终package/lock已对齐实际编译器5.8.3，并核对官方npm的完整性字段。重新在线npm ci尚未成功验收；ZIP内编译前端已用5.8.3实际编译和执行，无需用户先安装Node。

|包|实际版本|用途|许可证元信息|
|---|---|---|---|
|fastapi|0.128.2|runtime|MIT|
|starlette|0.50.0|runtime|BSD-3-Clause|
|pydantic|2.13.4|runtime|MIT|
|pydantic_core|2.46.4|runtime|MIT|
|uvicorn|0.48.0|runtime|BSD-3-Clause|
|python-multipart|0.0.29|runtime|Apache-2.0|
|openpyxl|3.1.5|runtime|MIT|
|defusedxml|0.7.1|runtime|PSFL|
|anyio|4.13.0|runtime|MIT|
|h11|0.16.0|runtime|MIT|
|typing-extensions|4.16.0|runtime|PSF-2.0|
|pytest|9.0.2|test-only|MIT|
|pytest-cov|7.0.0|test-only|MIT|
|coverage|7.13.3|test-only|Apache-2.0|
|httpx|0.28.1|test-only|BSD-3-Clause|
|playwright|1.57.0|test-only|Apache-2.0|
|pypdf|5.9.0|optional-blocked|BSD-3-Clause|

前端编译器TypeScript5.8.3：Apache-2.0，编译后的项目代码不携带TypeScript编译器文件。项目没有附第三方字体文件或node_modules/site-packages。依赖许可元信息不等于对整个项目权属的认定。更完整运行环境见evidence/environment.json；官方版本链接与安全资料见SECURITY.md。

PDF不再列为核心依赖；检测到旧pypdf时拒绝解析。requirements-pdf.txt是单独安装和验收路径，不能将此环境的5.9.0当作受支持解析器。

失败探针：evidence/dependency-network.json、npm-install-online.log。没有生成伪造的pip-audit通过报告。正式环境应联网更新并跑安全审计、兼容回归；锁定旧版本本身不是安全保证。
