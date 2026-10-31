const chunks = []
for await (const chunk of process.stdin) chunks.push(chunk)

const input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
const controller = new AbortController()
const timeout = setTimeout(() => controller.abort(), 50_000)

try {
  const response = await fetch(`${input.base_url.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.api_key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input.payload),
    signal: controller.signal,
  })
  const body = await response.text()
  process.stdout.write(JSON.stringify({ status: response.status, body }))
} catch (error) {
  process.stdout.write(JSON.stringify({
    status: 0,
    error: error instanceof Error ? error.name : 'RequestError',
  }))
  process.exitCode = 1
} finally {
  clearTimeout(timeout)
}
