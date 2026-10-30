# Deploy CSP Explained

The site is a static build on AWS: S3 and CloudFront, defined with the CDK in `infra/`. These steps set it up for
your own account and domain; after that, every push to `main` that passes CI is deployed.

1. Create the GitHub repository and set `REPO_URL` in `src/config.ts` and `githubRepo` in `infra/cdk.json`. Newer
   repositories need `githubRepo` as GitHub writes it in the deploy token, with IDs (`owner@123/repo@456`): a refused
   deploy shows it as `userName` in the `AssumeRoleWithWebIdentity` event in CloudTrail.
2. Choose the domain: set `SITE_URL` in `src/config.ts`. For a custom domain, its Route 53 hosted zone must exist
   (created automatically when the domain is registered with Route 53). Create an ACM certificate in **us-east-1**
   for both `example.com` and `*.example.com` (a wildcard alone doesn't cover the bare domain), then set
   `domainName`, `certificateArn` and `hostedZoneId` in `infra/cdk.json`.
   The stack adds the DNS records and redirects `www.` to the domain.
3. Set up least-privilege deploys (once, with an administrator account). CloudFormation deploys the stack through
   an execution role limited to what this stack creates, and your everyday user can only use CDK's roles:
   - [`infra/iam/cfn-execution-policy.json`](infra/iam/cfn-execution-policy.json): what CloudFormation may create
     (the site bucket, CloudFront, DNS records, `CspExplainedSite-*` roles, the usage Lambda, log group and dashboard).
   - [`infra/iam/deployer-policy.json`](infra/iam/deployer-policy.json): attach it to the IAM user (or group) that
     runs `cdk deploy`. It only allows assuming the `cdk-hnb659fds-*` roles created by `cdk bootstrap`.

   Both files contain this site's account, region and hosted zone: replace them with yours.
   ```sh
   aws iam create-policy --policy-name CspExplainedCfnExecution \
     --policy-document file://infra/iam/cfn-execution-policy.json
   cd infra
   yarn cdk bootstrap --cloudformation-execution-policies arn:aws:iam::ACCOUNT_ID:policy/CspExplainedCfnExecution
   ```
4. Deploy the infrastructure from your machine with the everyday user: `yarn infra:deploy` (add
   `-c githubOidcProviderArn=…` if your account already has the GitHub OIDC provider). CI never deploys the
   infrastructure: run it again after changing `infra/`, **before** pushing site code that depends on it.
   If the stack gains a new kind of resource, extend the execution policy first:
   ```sh
   aws iam create-policy-version --set-as-default \
     --policy-arn arn:aws:iam::ACCOUNT_ID:policy/CspExplainedCfnExecution \
     --policy-document file://infra/iam/cfn-execution-policy.json
   ```
   A policy keeps at most five versions: delete an old one when AWS refuses a new one.
5. In GitHub, add the repository variables printed as outputs: `AWS_DEPLOY_ROLE_ARN`, `SITE_BUCKET`, `DISTRIBUTION_ID`, plus `AWS_REGION`, and create a `production` environment. In its settings, add yourself as required reviewer,
   untick "Allow administrators to bypass", and limit deployment branches to `main`. The AWS deploy role only
   trusts jobs in that environment, so nothing else can reach AWS.
6. Every push to `main` that passes CI is deployed by `.github/workflows/deploy.yml`, once you approve it
   (the run waits under Actions › Deploy › Review deployments). Pushes that change nothing the site is built
   from (workflows, `infra/`, tests, scripts, Markdown docs) skip the deploy and ask for nothing. The deploy
   marks the commit it put live with a `deploy/production` status, which the next run compares with; a
   manual run (Actions › Deploy › Run workflow) always deploys.
