# ESXi ISO Builder

发布分支：`main`
源码分支：`dev`

一款基于 Web 界面的 ESXi 自定义镜像构建工具，支持自动集成驱动与补丁。这个分支（`main`）只保留发布说明、Docker 镜像入口和界面截图。完整源码请切换到 `dev`。

---

## 🚀 启动

使用 Docker Compose 快速部署：

```bash
docker-compose pull
docker-compose up -d
```

默认访问：
```text
http://localhost:8080
```

---

## 📂 核心资源

- `Dockerfile`: 容器镜像定义
- `docker-compose.yml`: 服务编排配置
- `docs/deployment.md`: 详细部署与环境配置说明

---

## 📸 界面截图 (点击预览原图)

<p align="left">
  <a href="docs/screenshots/overview.png" target="_blank">
    <img src="docs/screenshots/overview.png" width="400" alt="总览" style="border: 1px solid #ddd; border-radius: 4px; padding: 5px; margin-right: 10px;" />
  </a>
  <a href="docs/screenshots/tasks.png" target="_blank">
    <img src="docs/screenshots/tasks.png" width="400" alt="任务与日志" style="border: 1px solid #ddd; border-radius: 4px; padding: 5px;" />
  </a>
</p>

---

## ⚖️ 开源协议

本项目采用 [MIT License](LICENSE) 协议开源。

- 您可以自由地使用、修改和分发本项目代码。
- 唯一的要求是在分发时保留原始的版权声明。

---

> 🛠 **开发与贡献**：[查看完整源码 (dev 分支)](https://your-repo-link/tree/dev)
