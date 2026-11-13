OpenCode Sapphire Windows 便携版（2.2.7）

请完整解压 win-unpacked 文件夹到空间充足且可写的磁盘，再打开 OpenCode.exe。
与程序并列的 data 文件夹用于启用便携模式，请保留本文件夹。

desktop：Desktop 设置、日志、登录凭据和按版本保存的 CLI 副本
session：界面缓存
share、config、cache、state：OpenCode 本地服务的数据、配置、缓存和服务注册
tmp：本程序及其子进程使用的临时目录

旧安装版在 C 盘的数据不会自动搬迁或删除。首次使用此便携版需要重新登录。
更新请下载新的解压包，关闭 Desktop 及其后台服务后保留并迁移整个 data 文件夹；
如需停止后台服务，在 win-unpacked 目录打开 PowerShell，执行：
$env:XDG_STATE_HOME = Join-Path $PWD "data\state"
& ".\resources\opencode-cli.exe" service stop

不要使用 NSIS 安装包覆盖便携版。本版本不启用安装器自动更新。
登录凭据使用 Windows 当前用户加密，跨电脑或跨用户移动后可能需要重新登录。

请将项目文件也保存在空间充足的磁盘。本模式不改变系统的用户主目录，
外部工具或 Windows 自身仍可能使用系统盘；不能代替操作系统必要的剩余空间。
便携版与普通安装版使用独立数据；如遇到服务端口占用，请先关闭另一版本的后台服务。
