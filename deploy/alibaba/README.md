# Deploying Synod on Alibaba Cloud

Synod's backend runs entirely on Alibaba Cloud, across two services:

| Layer | Alibaba Cloud service | Where in this repo |
|---|---|---|
| Backend host — the Express server (`src/server.ts`) serving the site, the API, and the SSE war-room stream | **ECS** (Elastic Compute Service) | `deploy/alibaba/setup-ecs.sh`, `deploy/alibaba/synod.service` |
| Reasoning layer — every judge, challenge, defense, and arbiter read | **Model Studio (DashScope)**, `qwen-max` + `qwen-turbo` | [`src/agents/qwen.ts`](../../src/agents/qwen.ts) |

## One-time setup

1. In the [ECS console](https://ecs.console.aliyun.com/), create an instance:
   - **Image**: Ubuntu 22.04 (or 24.04)
   - **Size**: any burstable 2 GiB instance (e.g. `ecs.e-c1m1.large`) is plenty — the server is a single Node process
   - **Security group**: allow inbound TCP **80** (HTTP) and **22** (SSH)
2. SSH in and run the bootstrap script:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/natalietdg/synod/master/deploy/alibaba/setup-ecs.sh | sudo bash -s -- <DASHSCOPE_API_KEY>
   ```

That's the whole deployment. The script installs Node 20, clones this repo, installs
dependencies, and registers Synod as a systemd service listening on port 80, so it
survives reboots and restarts on failure.

## Operating

```bash
sudo systemctl status synod      # is it up?
sudo journalctl -u synod -f      # tail the logs
sudo /opt/synod/deploy/alibaba/setup-ecs.sh <DASHSCOPE_API_KEY>   # re-run = pull latest + restart
```

## Provider modes

The service file sets `LLM_PROVIDER=qwen`, so the deployed instance reasons with live
Qwen via Model Studio. To exercise the pipeline without spending tokens, edit
`/etc/synod.env` to `LLM_PROVIDER=mock` and `sudo systemctl restart synod` — the
deterministic mock agents run the identical protocol.
