# RojAnda transcription backend — deployment IAM (proposal)

This directory is a **proposal** for the isolated RojAnda transcription backend's
deployment identity and runtime permissions boundary. **Nothing here has been
created in AWS.** Account `387276719593`, region `us-east-1`.

It deliberately does **not** touch or broaden the frozen RojLearn deployer
(`courselens-deployer`) or the RojLearn boundary. RojAnda gets its own
dedicated, least-privilege identity and its own boundary.

Files:
- `rojanda-deploy-policy.json` — identity policy for a **new** `rojanda-deployer`
  user (what it may do to deploy the `rojanda-transcribe` SAM stack).
- `rojanda-execution-boundary.json` — the **permissions boundary** applied to the
  Lambda execution role (the hard runtime cap).
- The Lambda execution role + its execution policy + the Cognito roles are
  defined in `../template.yaml` (created by the stack itself).

---

## One-time admin steps (run with the `default` / `rojai-deployer` admin profile)

These mirror how RojLearn's boundary was created out-of-band by an admin, so the
deployer can never widen its own ceiling. **Show-then-apply**: these are listed
for your review; they are only run after you approve the final infra list.

1. Create the RojAnda execution boundary (admin-owned):
   ```
   aws iam create-policy \
     --policy-name rojanda-execution-boundary \
     --policy-document file://rojanda-backend/iam/rojanda-execution-boundary.json \
     --profile default
   ```
2. Create the dedicated deployer identity + policy (admin-owned):
   ```
   aws iam create-user --user-name rojanda-deployer --profile default
   aws iam create-policy \
     --policy-name rojanda-deploy-policy \
     --policy-document file://rojanda-backend/iam/rojanda-deploy-policy.json \
     --profile default
   aws iam attach-user-policy --user-name rojanda-deployer \
     --policy-arn arn:aws:iam::387276719593:policy/rojanda-deploy-policy \
     --profile default
   aws iam create-access-key --user-name rojanda-deployer --profile default
   # -> store as a new [rojanda] CLI profile; used for all rojanda-* deploys
   ```

Only the boundary + user + deploy-policy are admin-created. Everything else
(bucket, function, execution role, execution policy, HTTP API + JWT authorizer,
Cognito User Pool + app client, DynamoDB `rojanda-app`, alarm) is created by the
stack under the `rojanda` deploy profile.

> Alternative: if you prefer not to create a second deployer user, an admin can
> deploy the stack directly with the `default` profile. The dedicated
> `rojanda-deployer` is the least-privilege, RojLearn-style option and is
> recommended. Either way, `courselens-deployer` is left unchanged.

---

## Execution role effective permissions (intersection with boundary)

`rojanda-transcribe-exec-role` gets the intersection of:
- attached policy `rojanda-transcribe-execution-policy` (defined in the template), and
- boundary `rojanda-execution-boundary`.

Effective runtime permissions — **nothing else**:
- CloudWatch Logs for `/aws/lambda/rojanda-*`
- `transcribe:StartTranscriptionJob` + `transcribe:GetTranscriptionJob`
- `s3:GetObject` + `s3:PutObject` on `rojanda-media-387276719593/*`

### Note on the Transcribe resource scope
`transcribe:StartTranscriptionJob` / `GetTranscriptionJob` do not support
per-job ARN resource scoping (job names are caller-chosen; the actions are
effectively account-scoped in IAM). The boundary therefore uses
`"Resource": "*"` for **exactly those two actions only**. Real per-user
isolation comes from (a) the S3 per-user key prefix, and (b) the Cognito
identity policy — see the security section of the approval doc. The Lambda can
start/read transcription jobs but can only read/write audio + output under the
one private media bucket.

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
