import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { requireJsonContentType } from '../../../server/rate-limit'
import { stopInterruptibleSend } from '../../../server/send-run-tracker'

export const Route = createFileRoute('/api/runs/$sessionKey/$requestId/stop')({
  server: {
    handlers: {
      POST: ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        const sessionKey = params.sessionKey.trim()
        const requestId = params.requestId.trim()
        if (!sessionKey || !requestId) {
          return json({ ok: false, error: 'sessionKey and requestId required' }, { status: 400 })
        }
        if (!stopInterruptibleSend(sessionKey, requestId)) {
          return json({ ok: false, error: 'Active send not found' }, { status: 404 })
        }
        return json({ ok: true, sessionKey, requestId })
      },
    },
  },
})
