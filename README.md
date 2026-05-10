# ESXi ISO Builder

一个用于 ESXi ISO 自动化构建的发布版镜像，提供存储挂载、文件库、自定义构建、任务日志和本机运行状态页面。

### 一键启动

```bash
docker compose pull
docker compose up -d
```

默认访问：

```text
http://localhost:8080
```

### 缩略图

<table>
  <tr>
    <td><img src="docs/screenshots/overview.png" width="240" alt="总览" /></td>
    <td><img src="docs/screenshots/buckets.png" width="240" alt="存储挂载" /></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/files.png" width="240" alt="文件库" /></td>
    <td><img src="docs/screenshots/build.png" width="240" alt="自定义构建" /></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/tasks.png" width="240" alt="任务与日志" /></td>
    <td></td>
  </tr>
</table>

### 开源协议

本仓库采用双许可：

- MIT
- Apache-2.0

完整文本见 [LICENSE-MIT](LICENSE-MIT) 和 [LICENSE-APACHE-2.0](LICENSE-APACHE-2.0)。
