---
type: Procedure
title: GitHub network failure diagnosis
description: Candidate diagnostic procedure for a gh request that cannot reach GitHub
tags: [candidate, github, network]
---

This is an illustrative candidate, not a verified incident in this repository.

If a `gh` request fails in a runtime without network access, check DNS, proxy and sandbox access before treating the failure as invalid credentials. Never print a token. Use an authorized network route and repeat the same read-only request to verify the diagnosis. Record the exact command and error without credential values.
