# Deploying to AWS (ECS Fargate)

> **Status: a plan, not a verified deployment.** The container images, health checks and
> configuration below match this repository, but I have not run it in an AWS account. Treat it as the
> path I would follow, and validate it in a staging environment first.

## Target architecture

```
            Route 53
               │
          CloudFront ──────────────► S3 bucket        static web app (client/dist)
               │  /api/*
               ▼
   Application Load Balancer  (TLS, health check: GET /api/ready)
               │
     ECS Fargate service  (2+ tasks across 2 AZs, image from ECR)
               │
      MongoDB Atlas  (private connection)      Secrets Manager: MONGODB_URI
               │
      CloudWatch Logs (JSON, one line per request, with requestId)
```

Why this shape:

- **Fargate** means no servers to patch and per-second billing. The trade-off, as with any move off a
  managed platform, is owning the pipeline in exchange for control over scaling and cost.
- **Web on S3 + CloudFront** serves the static build from the edge. The Docker `web` target (nginx)
  that `docker compose --profile app` uses is the simpler alternative: one more container instead of
  a bucket and a distribution.
- **Atlas** over self-managed MongoDB: backups, replica set and upgrades are not my job.

## Configuration

| Variable             | Value in AWS                                                        | Source              |
| -------------------- | ------------------------------------------------------------------- | ------------------- |
| `NODE_ENV`           | `production`                                                        | task definition     |
| `PORT`               | `4000`                                                              | task definition     |
| `MONGODB_URI`        | Atlas connection string                                             | **Secrets Manager** |
| `CORS_ORIGIN`        | the public web origin                                               | task definition     |
| `TRUST_PROXY`        | `1` behind the ALB only; `2` if CloudFront also forwards to the ALB | task definition     |
| `LOG_LEVEL`          | `info`                                                              | task definition     |
| `STATS_CACHE_TTL_MS` | `5000` (per task)                                                   | task definition     |
| `API_DOCS`           | unset (docs are off in production)                                  | n/a                 |

`TRUST_PROXY` must equal the number of proxies in front of the API. If it is too low, the rate limiter
sees the load balancer's IP and throttles everyone as one client. If it is too high, clients can spoof
their address.

## Task definition (excerpt)

```json
{
  "family": "task-manager-api",
  "requiresCompatibilities": ["FARGATE"],
  "networkMode": "awsvpc",
  "cpu": "256",
  "memory": "512",
  "containerDefinitions": [
    {
      "name": "api",
      "image": "<account>.dkr.ecr.<region>.amazonaws.com/task-manager-api:<git-sha>",
      "portMappings": [{ "containerPort": 4000 }],
      "stopTimeout": 30,
      "environment": [
        { "name": "NODE_ENV", "value": "production" },
        { "name": "PORT", "value": "4000" },
        { "name": "TRUST_PROXY", "value": "1" },
        { "name": "CORS_ORIGIN", "value": "https://tasks.example.com" }
      ],
      "secrets": [
        {
          "name": "MONGODB_URI",
          "valueFrom": "arn:aws:secretsmanager:<region>:<account>:secret:task-manager/mongodb-uri"
        }
      ],
      "healthCheck": {
        "command": [
          "CMD-SHELL",
          "node -e \"fetch('http://127.0.0.1:4000/api/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))\""
        ],
        "interval": 15,
        "timeout": 3,
        "retries": 3,
        "startPeriod": 10
      },
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/task-manager-api",
          "awslogs-region": "<region>",
          "awslogs-stream-prefix": "api"
        }
      }
    }
  ]
}
```

- **Health check on `/api/ready`, not `/api/health`.** Readiness is 503 until MongoDB is connected, so
  the load balancer never sends traffic to a task that cannot serve it. Liveness (`/api/health`) only
  says the process is up.
- **`stopTimeout` 30s** is longer than the app's 10s graceful-shutdown window, so in-flight requests
  finish before ECS sends SIGKILL during a deploy. Set the target group's deregistration delay to a
  similar value.

## Build and deploy

The `Dockerfile` has an `api` target. The pipeline sketch (GitHub Actions with OIDC, no long-lived keys):

```yaml
deploy:
  needs: check # the existing CI job: lint, typecheck, tests, build
  if: github.ref == 'refs/heads/main'
  runs-on: ubuntu-latest
  permissions:
    id-token: write # OIDC
    contents: read
  steps:
    - uses: actions/checkout@v4
    - uses: aws-actions/configure-aws-credentials@v4
      with:
        role-to-assume: arn:aws:iam::<account>:role/github-deploy
        aws-region: <region>
    - uses: aws-actions/amazon-ecr-login@v2
      id: ecr
    - run: |
        docker build --target api -t $REGISTRY/task-manager-api:${{ github.sha }} .
        docker push $REGISTRY/task-manager-api:${{ github.sha }}
      env:
        REGISTRY: ${{ steps.ecr.outputs.registry }}
    # render the task definition with the new image, then update the service and wait
    - uses: aws-actions/amazon-ecs-deploy-task-definition@v2
      with:
        task-definition: infra/task-definition.json
        service: task-manager-api
        cluster: task-manager
        wait-for-service-stability: true
```

Enable the **ECS deployment circuit breaker with rollback**: a release whose tasks never become healthy
(bad config, cannot reach Atlas) rolls back by itself to the previous task-definition revision. Tag
images with the git SHA, never `latest`, so every revision is reproducible and a rollback is exact.

## Database

- Atlas M10 or larger for production, with a private connection (PrivateLink or VPC peering) and an
  IP/security-group allow-list, never `0.0.0.0/0`.
- **Indexes.** The API creates its indexes on startup (Mongoose `autoIndex`). That is fine for a new
  database and small collections. On a large existing collection, build them first in a maintenance
  step so a deploy never waits on an index build: `Task.syncIndexes()` from a one-off task. The unique
  idempotency-key index and the TTL index are required for correctness, not just speed.
- The query plans and the indexes chosen for them are measured in `DECISIONS.md`.

## Observability

- Logs are JSON with `requestId`, `method`, `path`, `status`, `durationMs`. CloudWatch Logs Insights:

  ```
  fields @timestamp, requestId, path, status, durationMs
  | filter status >= 500
  | sort @timestamp desc
  ```

- The browser shows server errors with a short reference (the first 8 characters of the request id),
  so a user report ("ref 3f2a9c1e") maps directly to the log lines.
- Alarms: ALB 5xx rate, target response time p95, ECS CPU and memory, unhealthy host count.
- Frontend errors: implement the `ErrorReporter` interface (`client/src/observability`) for Sentry or
  Last9 and change one line. The error boundary, global handlers and 5xx/timeout reports already flow
  through it.

## Scaling notes: what changes beyond one task

| Concern       | Today (per process)                                        | With several tasks                                                                                                          |
| ------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Stats cache   | in-memory, 5s TTL, invalidated on writes through this task | up to one TTL stale after a write on another task; use ElastiCache (Redis) behind the `Cache` interface for one shared view |
| Rate limiting | in-memory counters                                         | per-task limits multiply; use a Redis store for `express-rate-limit`                                                        |
| Idempotency   | MongoDB (shared, atomic)                                   | already correct across tasks; Redis would be faster at high load                                                            |
| Sessions/auth | none                                                       | not needed until authentication exists                                                                                      |
| Search        | regex scan                                                 | text index or Atlas Search before the collection grows                                                                      |

## Security checklist

- Containers run as non-root (`node` user for the API, `nginx-unprivileged` for the web image).
- Secrets only in Secrets Manager, injected as environment variables at start; none in the image or repo.
- Security groups: the ALB accepts 443 from the internet; tasks accept traffic only from the ALB;
  nothing else is reachable.
- TLS terminates at CloudFront/ALB; HSTS is sent by the API (Helmet).
- AWS WAF in front of CloudFront for managed rule sets and an IP rate limit as a second layer.
- API docs are disabled in production by default.
