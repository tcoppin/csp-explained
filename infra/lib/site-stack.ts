import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';
import { HEADER_POLICY } from '../../src/site-policy.ts';

export interface SiteStackProps extends StackProps {
  /**
   * Repository allowed to deploy through GitHub Actions OIDC, as GitHub writes it in the token's `sub` claim:
   * `owner@ownerId/repo@repoId` for newer repositories (the IDs survive renames), `owner/repo` for older ones.
   */
  githubRepo: string;
  /** Existing GitHub OIDC provider ARN; one is created when absent (only one per account is allowed). */
  githubOidcProviderArn?: string;
  /**
   * Custom domain (apex, e.g. `example.com`), its ACM certificate (us-east-1, covering the apex and `www.`)
   * and its Route 53 hosted zone. All three or none. `www.` redirects to the apex.
   */
  domainName?: string;
  certificateArn?: string;
  hostedZoneId?: string;
}

/**
 * Static hosting: private S3 bucket behind CloudFront (Origin Access Control),
 * security headers including our own CSP header, and a GitHub Actions deploy role.
 */
export class SiteStack extends Stack {
  constructor(scope: Construct, id: string, props: SiteStackProps) {
    super(scope, id, props);

    const bucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const domain = props.domainName && props.certificateArn && props.hostedZoneId ? props.domainName : undefined;
    if (!domain && (props.domainName || props.certificateArn || props.hostedZoneId)) {
      throw new Error('domainName, certificateArn and hostedZoneId must be provided together');
    }

    // Astro builds /learn as /learn/index.html: map clean URLs to their file.
    // With a custom domain, www. redirects to the apex first.
    const cleanUrls = new cloudfront.Function(this, 'CleanUrls', {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(`
var WWW_HOST = ${JSON.stringify(domain ? `www.${domain}` : null)};
var CANONICAL = ${JSON.stringify(domain ? `https://${domain}` : null)};

function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (WWW_HOST && request.headers.host && request.headers.host.value === WWW_HOST) {
    var query = Object.keys(request.querystring).map(function (key) {
      var param = request.querystring[key];
      var values = param.multiValue ? param.multiValue : [param];
      return values.map(function (v) { return v.value === '' ? key : key + '=' + v.value; }).join('&');
    }).join('&');
    return {
      statusCode: 301,
      statusDescription: 'Moved Permanently',
      headers: {
        location: { value: CANONICAL + uri + (query ? '?' + query : '') },
        'strict-transport-security': { value: 'max-age=31536000; includeSubDomains' },
      },
    };
  }
  if (uri.endsWith('/')) {
    request.uri = uri + 'index.html';
  } else if (!uri.split('/').pop().includes('.')) {
    request.uri = uri + '/index.html';
  }
  return request;
}`),
    });

    const headers = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeaders', {
      comment: 'CSP Explained security headers (CSP header part: see src/site-policy.ts)',
      securityHeadersBehavior: {
        contentSecurityPolicy: { contentSecurityPolicy: HEADER_POLICY, override: true },
        strictTransportSecurity: { accessControlMaxAge: Duration.days(365), includeSubdomains: true, override: true },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN, override: true },
      },
      customHeadersBehavior: {
        customHeaders: [
          { header: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()', override: true },
          { header: 'Cross-Origin-Opener-Policy', value: 'same-origin', override: true },
        ],
      },
    });

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: 'CSP Explained',
      defaultRootObject: 'index.html',
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      ...(domain && props.certificateArn
        ? {
            domainNames: [domain, `www.${domain}`],
            minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
            certificate: acm.Certificate.fromCertificateArn(this, 'Certificate', props.certificateArn),
          }
        : {}),
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: headers,
        functionAssociations: [{ function: cleanUrls, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
      },
      errorResponses: [
        // A private bucket answers 403 for missing keys.
        { httpStatus: 403, responseHttpStatus: 404, responsePagePath: '/404.html', ttl: Duration.minutes(5) },
        { httpStatus: 404, responseHttpStatus: 404, responsePagePath: '/404.html', ttl: Duration.minutes(5) },
      ],
    });

    if (domain && props.hostedZoneId) {
      const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', { hostedZoneId: props.hostedZoneId, zoneName: domain });
      const target = route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution));
      for (const [id, recordName] of [['Apex', domain], ['Www', `www.${domain}`]] as const) {
        new route53.ARecord(this, `${id}A`, { zone, recordName, target });
        new route53.AaaaRecord(this, `${id}Aaaa`, { zone, recordName, target });
      }
    }

    // GitHub Actions deploys with short-lived credentials: no AWS keys stored in GitHub.
    const providerArn =
      props.githubOidcProviderArn ??
      new iam.OidcProviderNative(this, 'GitHubOidc', {
        url: 'https://token.actions.githubusercontent.com',
        clientIds: ['sts.amazonaws.com'],
      }).oidcProviderArn;

    const deployRole = new iam.Role(this, 'GitHubDeployRole', {
      description: `Deploys the site from ${props.githubRepo} (main branch)`,
      maxSessionDuration: Duration.hours(1),
      assumedBy: new iam.WebIdentityPrincipal(providerArn, {
        // Jobs that use a GitHub environment identify as the environment, not the branch.
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          'token.actions.githubusercontent.com:sub': [
            `repo:${props.githubRepo}:ref:refs/heads/main`,
            `repo:${props.githubRepo}:environment:production`,
          ],
        },
      }),
    });
    bucket.grantReadWrite(deployRole);
    bucket.grantDelete(deployRole);
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['cloudfront:CreateInvalidation'],
        resources: [`arn:${this.partition}:cloudfront::${this.account}:distribution/${distribution.distributionId}`],
      }),
    );

    new CfnOutput(this, 'BucketName', { value: bucket.bucketName });
    new CfnOutput(this, 'DistributionId', { value: distribution.distributionId });
    new CfnOutput(this, 'SiteUrl', { value: `https://${domain ?? distribution.distributionDomainName}` });
    new CfnOutput(this, 'DeployRoleArn', { value: deployRole.roleArn });
  }
}
