# Platform Boundaries

## API Hub owns

- product, service, and approved external-integration registry;
- service identities and credential lifecycle;
- API, event, webhook, callback, receipt, and error contracts;
- routing, delivery, retry, dead-letter, replay, and recovery controls;
- idempotency, correlation, causation, signed receipts, and audit trail;
- rate limits, destination allow lists, connector health, and kill switches;
- onboarding standards, fixtures, SDKs, and integration documentation.

## API Hub does not own

- connected-product databases or business logic;
- product-user authorization decisions;
- customer, legal-evidence, payment, camera, audio, or long-term location storage;
- cannabis regulator credentials or official regulator records;
- compliance-policy approval or legal conclusions;
- AI model governance or autonomous high-impact decisions;
- automatic emergency dispatch.

## Required rule

No product may directly query another product's database. A connected product authenticates with an environment-specific service identity, uses an approved versioned contract, receives only scoped data, and retains responsibility for local tenant and user authorization.
