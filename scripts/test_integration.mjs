import { spawn } from "child_process"
import net from "net"
import http from "http"

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

async function fetchApi(port, path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "127.0.0.1",
      port: port,
      path: path,
      method: "GET",
      timeout: 10000,
    }
    const req = http.request(options, (res) => {
      let data = ""
      res.on("data", (chunk) => (data += chunk))
      res.on("end", () => {
        try {
          resolve({
            status: res.statusCode,
            data: data ? JSON.parse(data) : null,
          })
        } catch (e) {
          resolve({ status: res.statusCode, data: data })
        }
      })
    })
    req.on("error", (e) => reject(e))
    req.on("timeout", () => {
      req.destroy()
      reject(new Error("timeout"))
    })
    req.end()
  })
}

async function runTest() {
  console.log("🚀 Starting Integration Test...")
  
  const testPort = 8099
  const free = await isPortFree(testPort)
  if (!free) {
    console.error(`❌ Port ${testPort} is not free. Please kill other processes.`)
    process.exit(1)
  }

  console.log(`📦 Starting Python API Server on port ${testPort}...`)
  const apiProcess = spawn(
    "uvicorn",
    ["api.akshare_server:app", "--host", "0.0.0.0", "--port", String(testPort)],
    { stdio: "pipe", env: { ...process.env, PYTHONUNBUFFERED: "1" } }
  )

  let serverOutput = ""
  apiProcess.stdout.on("data", (d) => {
    serverOutput += d
    process.stdout.write(`[Server]: ${d}`)
  })
  apiProcess.stderr.on("data", (d) => {
    serverOutput += d
    process.stderr.write(`[Server Error]: ${d}`)
  })

  // Wait for server to be ready
  let ready = false
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetchApi(testPort, "/health")
      if (res.status === 200) {
        ready = true
        break
      }
    } catch (e) {}
    await new Promise(r => setTimeout(r, 1000))
  }

  if (!ready) {
    console.error("❌ Server failed to start or health check failed.")
    apiProcess.kill()
    process.exit(1)
  }

  console.log("✅ Server is ready. Testing /holdings?code=001917...")
  
  try {
    const res = await fetchApi(testPort, "/holdings?code=001917")
    console.log(`📡 Response Status: ${res.status}`)
    console.log(`📄 Response Data:`, JSON.stringify(res.data, null, 2))

    if (res.status === 200 && res.data.holdings && res.data.holdings.length > 0) {
      console.log("🎉 SUCCESS: Integration test passed!")
    } else {
      console.error("❌ FAILURE: API returned error or empty data.")
      process.exit(1)
    }
  } catch (e) {
    console.error(`❌ FAILURE: Request failed: ${e.message}`)
    process.exit(1)
  } finally {
    console.log("🧹 Cleaning up...")
    apiProcess.kill()
  }
}

runTest().catch(err => {
  console.error("💥 Unhandled Error:", err)
  process.exit(1)
})
