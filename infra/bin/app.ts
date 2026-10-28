import { App } from 'aws-cdk-lib';
import { SiteStack } from '../lib/site-stack.ts';

const app = new App();
const ctx = (key: string): string | undefined => app.node.tryGetContext(key) || undefined;

new SiteStack(app, 'CspExplainedSite', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: ctx('region') ?? process.env.CDK_DEFAULT_REGION ?? 'ca-central-1' },
  githubRepo: ctx('githubRepo') ?? 'tcoppin/csp-explained',
  githubOidcProviderArn: ctx('githubOidcProviderArn'),
  domainName: ctx('domainName'),
  certificateArn: ctx('certificateArn'),
  hostedZoneId: ctx('hostedZoneId'),
});
