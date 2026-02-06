import { spawn } from "child_process"
import net from "net"

async function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once("error", () => resolve(false))
    server.once("listening", () => {
      server.close(() => resolve(true))
    })
    server.listen(port, "0.0.0.0")
  })
}

async function findPort(start, attempts) {
  for (let i = 0; i < attempts; i += 1) {
    const port = start + i
    if (await isPortFree(port)) return port
  }
  throw new Error("no available port")
}

async function waitHealth(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`)
      if (res.ok) return true
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
  }
  return false
}

function waitProcessExit(proc) {
  return new Promise((resolve) => {
    proc.once("exit", (code, signal) => resolve({ code, signal }))
    proc.once("error", () => resolve({ code: null, signal: "error" }))
  })
}

async function startApi(startPort, attempts) {
  for (let i = 0; i < attempts; i += 1) {
    const port = startPort + i
    if (!(await isPortFree(port))) continue

    const apiProcess = spawn(
      "uvicorn",
      ["api.akshare_server:app", "--host", "0.0.0.0", "--port", String(port)],
      { stdio: "inherit", env: { ...process.env, PYTHONUNBUFFERED: "1" } },
    )

    const ready = await Promise.race([
      waitHealth(port, 15000),
      waitProcessExit(apiProcess).then(() => false),
    ])

    if (ready) return { port, apiProcess }

    apiProcess.kill("SIGINT")
    await waitProcessExit(apiProcess)
  }
  throw new Error("api not ready")
}

async function main() {
  const { port, apiProcess } = await startApi(8001, 20)
  console.log(`✅ API Server is running on port ${port}`)

  const clientEnv = { ...process.env, VITE_HOLDINGS_API_BASE_URL: `http://127.0.0.1:${port}` }
  const devProcess = spawn("npm", ["run", "dev:client"], { stdio: "inherit", env: clientEnv })

  const shutdown = () => {
    devProcess.kill("SIGINT")
    apiProcess.kill("SIGINT")
  }
  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)

  devProcess.on("exit", (code) => {
    apiProcess.kill("SIGINT")
    process.exit(code ?? 0)
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
