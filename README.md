# ARMA API Hub

ARMA API Hub is the secure shared integration control plane for systems owned and operated by Full Stack Tech & Solutions LLC (FSTS).

It provides service identity, versioned API and event contracts, webhook delivery, durable retries, idempotency, signed receipts, connector health, rate limits, kill switches, and integration auditability.

## Architectural boundary

Each connected product retains ownership of its database, tenant authorization, business logic, customer data, and product-specific audit records. ARMA API Hub does not permit direct cross-product database access and does not replace local authorization controls.

## Status

Foundation and architecture planning. Production integrations are not yet authorized.

## Security

Do not report vulnerabilities through public issues. Use GitHub private vulnerability reporting as described in [SECURITY.md](SECURITY.md).

## License

This repository is publicly visible but is not open-source software. See [LICENSE](LICENSE).