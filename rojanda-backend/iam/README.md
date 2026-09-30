# RojAnda transcription backend — deployment IAM (proposal)

This directory defines the isolated RojAnda transcription backend's deployment
IAM and the runtime permissions boundary. **Nothing here has been created in
AWS.** Account `387276719593`, region `eu-central-1` (Frankfurt — the RojAnda
production target).

It deliberately does **not** touch or broaden the frozen RojLearn deployer
(`courselens-deployer`) or the RojLearn boundary. RojAnda's boundary and deploy
policy are its own, least-privilege, and scoped to `rojanda-*` names only.

Files:
- `rojanda-deploy-policy.json` — the least-privilege identity policy describing
  exactly what is needed to deploy the `rojanda-transcribe` SAM stack. Kept as a
  reusable artifact; it can be attached to a dedicated deployer later (see
  "Future hardening" below).
- `rojanda-execution-boundary.json` — the **permissions boundary** applied to the
  Lambda execution role (the hard runtime cap).
- The Lambda execution role + its execution policy + the Cognito User Pool /
  app client are defined in `../template.yaml` (created by the stack itself).

---

## Initial beta deployment (current decision)

For the initial RojAnda beta, the stack is deployed with the **currently
authenticated admin identity** (`rojai-deployer`). No dedicated `rojanda-deployer`
user, no access keys, and no new CLI profile are created for the beta.

Only one admin-owned prerequisite must exist before the first `sam deploy`: the
execution permissions boundary. It is created out-of-band (not by the stack) so
that the runtime execution role can never widen its own ceiling:

```
aws iam create-policy \
  --policy-name rojanda-execution-boundary \
  --policy-document file://rojanda-backend/iam/rojanda-execution-boundary.json
```

Everything else — media bucket, `rojanda-api` function, execution role,
execution policy, HTTP API + JWT authorizer, Cognito User Pool + app client,
DynamoDB `rojanda-app`, cost alarm + topic — is created by the SAM stack itself,
in `eu-central-1`, using the same authenticated admin identity.

`courselens-deployer` / the frozen RojLearn boundary are left unchanged.

## Future hardening (optional, not for the beta)

When more operators are involved, replace the admin-identity deploy with a
dedicated least-privilege identity by attaching `rojanda-deploy-policy` to a
`rojanda-deployer` principal. Prefer short-lived credentials (an assumable role
or IAM Identity Center / SSO session) over a long-lived access key. The
`rojanda-deploy-policy.json` in this directory is authored for exactly this and
can be attached without other changes.

---

## Execution role effective permissions (intersection with boundary)

`rojanda-transcribe-exec-role` gets the intersection of:
- attached policy `rojanda-transcribe-execution-policy` (defined in the template), and
- boundary `rojanda-execution-boundary`.

Effective runtime permissions — **nothing else**:
- CloudWatch Logs for `/aws/lambda/rojanda-*`
- `transcribe:StartTranscriptionJob` + `transcribe:GetTranscriptionJob`
- `s3:GetObject` + `s3:PutObject` on `rojanda-media-387276719593/*`
- On DynamoDB `rojanda-app` only: `GetItem`, `PutItem`, `UpdateItem`,
  `DeleteItem`, `Query`, `BatchWriteItem` (the single-table access the API
  needs for profile / course / lesson / source / transcript / job / usage
  items, all partitioned by `OWNER#<sub>`)

### Note on the Transcribe resource scope
`transcribe:StartTranscriptionJob` / `GetTranscriptionJob` do not support
per-job ARN resource scoping (job names are caller-chosen; the actions are
effectively account-scoped in IAM). The boundary therefore uses
`"Resource": "*"` for **exactly those two actions only**. Real per-user
isolation comes from (a) the per-owner S3 key prefix (`owners/<sub>/...`), and
(b) the server-side ownership check that derives `ownerId` from the verified
Cognito User Pool JWT `sub` (there is no Identity Pool and the client holds no
AWS credentials). The Lambda can start/read transcription jobs but can only
read/write audio + output under the one private media bucket, and can only
touch the single `rojanda-app` table.

---

## Deploy policy — statement summary

| Sid | Purpose | Scope |
|---|---|---|
| `CloudFormationRojandaStacksOnly` | SAM/CFN stack ops | `stack/rojanda-*/*` |
| `CloudFormationValidateAndListReadOnly` | validate/list | `*` (read-only) |
| `CloudFormationSamTransformOnly` | SAM transform | the SAM transform ARN |
| `LambdaRojandaFunctionsOnly` | function CRUD + resource policy | `function:rojanda-*` |
| `ApiGatewayV2HttpApi` / `RojandaStageCreationTagging` | create the HTTP API | `/apis*`, stages tags |
| `IamCreateBoundedRojandaRoleOnly` | create exec role **with the boundary** | `role/rojanda-*` + `iam:PermissionsBoundary` condition |
| `IamManageRojandaExecutionRoleOnly` | manage/delete role, trust, tags | `role/rojanda-*` |
| `IamManageRojandaExecutionManagedPolicyOnly` | manage the exec managed policy + versions | `policy/rojanda-transcribe-execution-policy` |
| `DenyAnyChangeToTheExecutionBoundaryItself` | **Deny** weakening the boundary | `policy/rojanda-execution-boundary` |
| `IamAttachOnlyRojandaPoliciesToRojandaRoles` | attach only the exec policy | `role/rojanda-*` + `iam:PolicyARN` condition |
| `IamPassRojandaLambdaRolesToLambdaOnly` | pass exec role to Lambda | `role/rojanda-transcribe-exec-role` + `PassedToService=lambda` |
| `CognitoUserPoolRojanda` | create/manage the User Pool + app client | `*` (Cognito `CreateUserPool` is not ARN-scopable at create time) |
| `DynamoDbRojandaAppTableOnly` | create/manage the single table | `table/rojanda-app` |
| `S3RojandaMediaBucket` | create/configure the private media bucket | `rojanda-media-387276719593` |
| `SamManagedArtifactBucket` | SAM artifacts | `aws-sam-cli-managed-default*`, `rojanda-sam-artifacts*` |
| `CloudWatchLogsForRojandaLambda` | manage the log group | `log-group:/aws/lambda/rojanda-*` |
| `CloudWatchAlarmsAndBudgetSafeguardRojanda` | create the cost/usage alarm | `alarm:rojanda-*` |
| `SnsCostAlarmTopicRojanda` | alarm notification topic | `sns:rojanda-*` |

Not granted anywhere: `AdministratorAccess`, `iam:*`, `s3:*`, `lambda:*`,
`cloudformation:*`, `iam:PutRolePolicy`, `iam:DeleteRolePolicy`,
`iam:PutRolePermissionsBoundary`, `iam:CreateUser`, `iam:CreateAccessKey`,
`iam:AttachUserPolicy`, `bedrock:*`, any Transcribe/S3 runtime action on the
deployer itself, and anything targeting `courselens*` / RojAI names.

---

## How RojLearn / RojAI stay isolated
Every resource-scoped statement targets `rojanda-*` names only. `courselens*`,
the `courselens-deployer`, the `courselens-execution-boundary`, `rojai-deployer`,
and the `default` profile are neither referenced nor modified. RojLearn's
deployer permissions are unchanged.

## Cost
Creating the IAM user, policies, boundary, and access key is free. These
proposal files create nothing.
