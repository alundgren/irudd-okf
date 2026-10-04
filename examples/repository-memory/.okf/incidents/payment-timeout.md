---
type: Policy
title: Payment timeout handling
description: Synthetic candidate example for a checkout payment request with an unknown outcome
tags: [candidate, synthetic, payments]
---

This rule applies only to an illustrative checkout implementation. It is not a fact about this repository's product code.

A timeout after submitting a payment does not establish whether the gateway charged the customer. Reconcile the original request before creating another payment and reuse its idempotency key when retrying. Verify the change with a test where the payment succeeds but the response times out.
