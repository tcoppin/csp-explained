import { App } from 'aws-cdk-lib';
import { SiteStack } from '../lib/site-stack.ts';

const app = new App();
const ctx = (key: string): string | undefined => app.node.tryGetContext(key) || undefined;

new SiteStack(app, 'CspExplainedSite', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: ctx('region') ?? process.env.CDK_DEFAULT_REGION ?? 'eu-west-3' },
  githubRepo: ctx('githubRepo') ?? 'OWNER/csp-explained',
  githubOidcProviderArn: ctx('githubOidcProviderArn'),
  domainName: ctx('domainName'),
  certificateArn: ctx('certificateArn'),
});
