# Jimeng CLI Wrapper

CloudRun wrapper for the Dreamina/Jimeng CLI. It exposes a small internal HTTP API used by `generationWorker`.

## Runtime

The container installs the CLI with:

```bash
curl -s https://jimeng.jianying.com/cli | bash
```

After deployment, log in inside the runtime environment and verify:

```bash
dreamina login
dreamina user_credit
```

Set `JIMENG_WRAPPER_TOKEN` to require `Authorization: Bearer <token>` on all `/jimeng/*` endpoints.
