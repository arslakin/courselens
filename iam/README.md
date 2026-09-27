# CourseLens deployment IAM — proposal (hardened)

This directory contains a **proposal** for how CourseLens gets its own,
least-privilege deployment identity, separate from `rojai-deployer`. Nothing
here has been created in AWS.

Files:
- `courselens-deploy-policy.json` — identity policy for the `courselens-deployer`
  user (what it may do to deploy the SAM stack).
- `courselens-execution-boundary.json` — the **permissions boundary** applied to
  the Lambda execution role (the hard cap on runtime permissions).
- The Lambda execution **role** and its **execution policy** are defined in
  `../template.yaml` (created by the stack itself).

Account `387276719593`, region `us-east-1`.

---

## What changed in this hardening pass

The earlier draft let the deployer hold `iam:PutRolePolicy` on `courselens-*`
roles, because SAM generated an **implicit** execution role with an **inline**
policy. Inline policies are written with `PutRolePolicy`, and IAM has no
condition key to restrict the *contents* of that inline document — so the
deployer could, in principle, write an arbitrary high-privilege inline policy on
the Lambda role. That is the escalation path this pass closes.

Three changes remove it:

1. **Explicit execution role in the template** (`courselens-api-execution-role`)
   instead of a SAM-generated implicit role.
2. **Runtime permissions delivered as a customer-managed policy**
   (`courselens-api-execution-policy`, attached by ARN) instead of an inline
   role policy. Managed policies are attached with `AttachRolePolicy`, which
   **does** support an `iam:PolicyARN` condition — so we lock attachment to that
   one policy ARN. This lets us **remove `iam:PutRolePolicy` and
   `iam:DeleteRolePolicy` from the deployer entirely.**
3. **A permissions boundary** (`courselens-execution-boundary`) on the execution
   role, created out-of-band by an admin. The deployer's `iam:CreateRole` is
   conditioned (`iam:PermissionsBoundary`) so any role it creates **must** carry
   this boundary. The boundary caps the role's effective permissions to Logs +
   Bedrock-Nova regardless of what policy is attached or versioned later.

### Which IAM policy-management actions CloudFormation still genuinely needs
With a managed-policy design, deploying/updating the stack requires:
- `iam:CreateRole` / `iam:DeleteRole` / `iam:GetRole` / `iam:UpdateAssumeRolePolicy`
  / tag actions — create and manage the execution role (scoped to
  `role/courselens-*`, and `CreateRole` requires the boundary).
- `iam:CreatePolicy` / `iam:DeletePolicy` / `iam:GetPolicy` /
  `iam:GetPolicyVersion` / `iam:ListPolicyVersions` / `iam:CreatePolicyVersion` /
  `iam:DeletePolicyVersion` — manage the **execution** managed policy. Stack
  updates change the policy document via a new **policy version**, so
  `CreatePolicyVersion`/`DeletePolicyVersion` are required. **Scoped to the exact
  policy `courselens-api-execution-policy`.**
- `iam:AttachRolePolicy` / `iam:DetachRolePolicy` — attach the execution policy
  to the role. **Conditioned to the exact execution-policy ARN.**
- `iam:PassRole` — CloudFormation passes the role to Lambda. **Scoped to
  `role/courselens-*` and `iam:PassedToService = lambda.amazonaws.com`.**

`iam:PutRolePolicy` / `iam:DeleteRolePolicy` are **not** required and are **not**
granted. They were only ever needed for the inline-policy design.

---

## The permissions boundary (create this ONCE, as an admin)

`courselens-execution-boundary.json` allows only:
- CloudWatch Logs for `/aws/lambda/courselens-*`
- `bedrock:InvokeModel` on `amazon.nova-*`

It must be created **out-of-band by an administrator (you / `rojai-deployer`),
not by `courselens-deployer`**, and its ARN passed to the stack via the
`ExecutionRolePermissionsBoundaryArn` parameter. The deploy policy contains an
explicit **Deny** on any action that could modify this boundary policy, so even
the deployer cannot weaken it.

Suggested admin command (reference only — not executed):
```
aws iam create-policy \
  --policy-name courselens-execution-boundary \
  --policy-document file://iam/courselens-execution-boundary.json
```

---

## Deploy policy — statement-by-statement

| Sid | Purpose | Scope |
|---|---|---|
| `CloudFormationCourseLensStacksOnly` | SAM/CFN stack ops | `stack/courselens*/*` |
| `CloudFormationValidateAndListReadOnly` | validate/list (account-level APIs) | `*` (read-only; no resource ARN possible) |
| `LambdaCourseLensFunctionsOnly` | create/update the function + its resource policy | `function:courselens-*` |
| `ApiGatewayV2HttpApi` | create the HTTP API | `/apis*`, `/tags/*` (id generated at create) |
| `IamCreateBoundedCourseLensRoleOnly` | create the exec role **with the boundary** | `role/courselens-*` + `iam:PermissionsBoundary` condition |
| `IamManageCourseLensExecutionRoleOnly` | manage/delete the exec role, trust policy, tags | `role/courselens-*` |
| `IamManageCourseLensExecutionManagedPolicyOnly` | manage the exec managed policy + its versions | `policy/courselens-api-execution-policy` |
| `DenyAnyChangeToTheExecutionBoundaryItself` | **Deny** weakening the boundary | `policy/courselens-execution-boundary` |
| `IamAttachOnlyCourseLensExecutionPolicyToCourseLensRoles` | attach the exec policy to the role | `role/courselens-*` + `iam:PolicyARN` = exec policy |
| `IamPassOnlyCourseLensRolesToLambda` | pass the role to Lambda | `role/courselens-*` + `PassedToService=lambda` |
| `SamManagedArtifactBucket` | SAM deployment artifacts | `aws-sam-cli-managed-default*`, `courselens-sam-artifacts*` |
| `CloudWatchLogsForCourseLensLambda` | manage the function's log group | `log-group:/aws/lambda/courselens-*` |

Not granted anywhere: `AdministratorAccess`, `iam:*`, `s3:*`, `lambda:*`,
`cloudformation:*`, `iam:PutRolePolicy`, `iam:DeleteRolePolicy`,
`sts:AssumeRole`, `iam:CreateUser`, `iam:CreateAccessKey`,
`iam:AttachUserPolicy`, `iam:PutUserPolicy`, and any Bedrock action.

---

## Execution role effective permissions

The role `courselens-api-execution-role` gets the **intersection** of:
- its attached policy `courselens-api-execution-policy` (Logs + `bedrock:InvokeModel` on Nova), and
- its permissions boundary `courselens-execution-boundary` (Logs + `bedrock:InvokeModel` on Nova).

Effective runtime permissions: **CloudWatch Logs for `/aws/lambda/courselens-*`
and `bedrock:InvokeModel` on `amazon.nova-*` — nothing else.**

---

## Re-run: privilege-escalation analysis

Considering each capability the deployer holds:

**`CreateRole`** — allowed only for `role/courselens-*` **and only if the role
carries the `courselens-execution-boundary`** (StringEquals condition on
`iam:PermissionsBoundary`). The deployer cannot create a role without the
boundary, and cannot create roles outside the CourseLens namespace.

**`AttachRolePolicy` / `DetachRolePolicy`** — conditioned (`ArnEquals
iam:PolicyARN`) to exactly `courselens-api-execution-policy`. The deployer
cannot attach `AdministratorAccess` or any other policy to any role. Even if it
could, the boundary would cap the result.

**`PutRolePolicy`** — **not granted at all.** The inline-policy escalation path
is gone.

**`CreatePolicy` / `CreatePolicyVersion` (execution policy)** — the deployer can
change the *execution policy's* document (this is inherent to being able to
deploy the app's runtime permissions). **But the boundary makes this harmless:**
the role's effective permissions are the intersection of the policy and the
boundary, so widening the execution policy to `bedrock:*` or `*` grants the role
nothing beyond Logs + Bedrock-Nova. The boundary policy itself is protected by
an explicit **Deny** (and is admin-created out-of-band), so the deployer cannot
raise the ceiling.

**`PassRole`** — restricted to `role/courselens-*` **and** to
`lambda.amazonaws.com`. A created role can only be handed to Lambda, never to
EC2/CloudFormation/a user. There is **no `sts:AssumeRole`**, so the deployer
cannot assume the role directly.

**Lambda `CreateFunction` / `UpdateFunctionConfiguration`** — scoped to
`function:courselens-*`. Setting a function's role requires `PassRole` on that
role, which is limited to `courselens-*` Lambda-only roles. So the deployer
cannot point a CourseLens Lambda at an arbitrary powerful role — it can only use
a bounded `courselens-*` role, whose permissions are capped by the boundary.

**Modify the execution role** — the deployer can manage the `courselens-*` role,
but cannot remove or change its permissions boundary to something weaker: there
is no `iam:PutRolePermissionsBoundary` / `iam:DeleteRolePermissionsBoundary`
granted, so the boundary cannot be stripped or swapped after creation.

**Point the Lambda at another role** — only `courselens-*` roles can be passed
(PassRole scope), and only to Lambda. No other account role is reachable.

### Remaining paths / residual risk
- The deployer can change the *execution policy* document, but the **boundary**
  neutralizes this — the Lambda can never gain permissions beyond Logs +
  Bedrock-Nova. This is the intended end state.
- The boundary is the linchpin: it must be created and owned by an admin, and
  the deploy policy's explicit Deny keeps the deployer from altering it. If the
  boundary were ever created *by* the deployer or left mutable, the protection
  would weaken — hence the out-of-band creation.
- Account-level `cloudformation:ValidateTemplate`/`ListStacks`/`ListExports` use
  `Resource: "*"` because they cannot be resource-scoped; they are read-only.

**End state achieved:** `courselens-deployer` can deploy the CourseLens SAM
stack, but **cannot grant the CourseLens Lambda arbitrary account permissions** —
the permissions boundary caps runtime permissions to Logs + Bedrock-Nova, and no
inline-policy or unbounded-role path exists.

---

## How RojAI stays isolated
Every resource-scoped statement targets `courselens*`/`courselens-*` names only.
The `default` profile and `rojai-deployer` are neither referenced nor modified.
The deployer cannot touch RojAI/Dengbej stacks, functions, roles, policies,
logs, or buckets.

## Cost
Creating the IAM user, policies, boundary, access key, and CLI profile is free.
These proposal files create nothing.
