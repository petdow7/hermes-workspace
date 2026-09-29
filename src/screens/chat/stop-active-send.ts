export async function requestStopActiveSend(sessionKey: string, requestId: string): Promise<boolean> {
  // Session resolution and catalog loading can delay registration; keep the
  // Stop pending long enough to reach the run rather than silently detaching.
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const response = await fetch(
      `/api/runs/${encodeURIComponent(sessionKey)}/${encodeURIComponent(requestId)}/stop`,
      {
        method: 'POST',
        credentials: 'same-origin',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      },
    )
    if (response.ok) return true
    if (response.status !== 404 || attempt === 299) {
      throw new Error(`Stop request failed (${response.status})`)
    }
    // The user may click Stop before the send POST reaches the server.
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return false
}
