# Windows 本地 VC Runtime

DBX `0.4.127` 的 Windows ARM64/x64 二进制直接导入 `VCRUNTIME140.dll`，上游 npm 包未携带该 DLL。这里保存 Microsoft 官方 `14.44.35211` 的原始、未修改 DLL，并通过公共构建脚本复制到对应 `dbx-mcp.exe` 同目录，避免依赖用户另外安装 VC Redistributable；Windows 自带 UCRT 和其他系统 DLL。

- `win32-arm64/vcruntime140.dll`：官方 ARM64 包 `cab1.cab` 内 `a1` CAB 的 `vcruntime140.dll_arm64`。
- `win32-x64/vcruntime140.dll`：官方 x64 包 `cab1.cab` 内 `a12` CAB 的 `vcruntime140.dll_amd64`。
- `provenance.json`：固定 Microsoft 下载地址、原始安装器 SHA-256、提取 DLL SHA-256。构建只复制已有文件，不执行安装器、不在运行时下载。
- `LICENSE.txt`：官方 Runtime 随附许可条款。Microsoft Runtime 不属于 DBX 的 Apache-2.0 许可；正式分发必须满足 Visual Studio 的 Distributable Code / REDIST 授权，发布者需确认其许可资格。

Microsoft 官方分发说明：https://learn.microsoft.com/en-us/cpp/windows/redistributing-visual-cpp-files 。这里只为 App 本地依赖闭包保留文件，不代表已获得独立分发授权或已经发布市场包。
