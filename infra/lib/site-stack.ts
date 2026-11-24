import { fileURLToPath } from 'node:url';
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';
import { buildSync } from 'esbuild';
import { HEADER_POLICY } from '../../src/site-policy.ts';
import { USAGE_EVENTS, USAGE_NAMESPACE } from '../../src/usage.ts';
import { VIOLATION_NAMESPACE } from '../../src/own-violations.ts';

/** Bundles a small handler into one CommonJS file, inlined in the template (no asset to upload). */
function bundle(entry: string): string {
  const { outputFiles } = buildSync({
    entryPoints: [fileURLToPath(new URL(entry, import.meta.url))],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    minify: true,
  });
  return outputFiles[0]!.text;
}

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
 * Usage counts: `/e` goes to a small Lambda that logs one line per event, read by a CloudWatch dashboard.
 * Our own policy's violations: `/csp-violation` goes to another one, watched by an alarm on the same dashboard.
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

    // Usage counts (see src/usage.ts) and our own policy's violations (see src/own-violations.ts): each a small
    // Lambda writing to its own log group. Their function URLs only accept CloudFront, through Origin Access Control.
    const usage = this.counter('Usage', 'CSP Explained usage counts', '../lambda/usage.ts', logs.RetentionDays.THIRTEEN_MONTHS);
    const violations = this.counter('Violations', "CSP Explained: what this site's own policy blocks", '../lambda/violations.ts', logs.RetentionDays.THREE_MONTHS);
    // Only the query string reaches the functions: no cookies, no headers (so no visitor IP).
    const counterRequests = new cloudfront.OriginRequestPolicy(this, 'UsageRequests', {
      comment: 'CSP Explained usage counts and violations: query string only',
      queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all(),
      headerBehavior: cloudfront.OriginRequestHeaderBehavior.none(),
      cookieBehavior: cloudfront.OriginRequestCookieBehavior.none(),
    });
    const counterBehavior = (url: lambda.FunctionUrl): cloudfront.BehaviorOptions => ({
      origin: origins.FunctionUrlOrigin.withOriginAccessControl(url),
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: counterRequests,
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
      additionalBehaviors: {
        '/e': counterBehavior(usage.url),
        '/csp-violation': counterBehavior(violations.url),
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

    this.usageDashboard(usage.logGroup, violations.logGroup);

    // GitHub Actions deploys with short-lived credentials: no AWS keys stored in GitHub.
    const providerArn =
      props.githubOidcProviderArn ??
      new iam.OidcProviderNative(this, 'GitHubOidc', {
        url: 'https://token.actions.githubusercontent.com',
        clientIds: ['sts.amazonaws.com'],
      }).oidcProviderArn;

    const deployRole = new iam.Role(this, 'GitHubDeployRole', {
      description: `Deploys the site from ${props.githubRepo} (production environment)`,
      maxSessionDuration: Duration.hours(1),
      assumedBy: new iam.WebIdentityPrincipal(providerArn, {
        // Only jobs in the `production` environment, which GitHub limits to `main` and holds for the owner's
        // approval (DEPLOY.md). Such jobs identify as the environment, not the branch.
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          'token.actions.githubusercontent.com:sub': `repo:${props.githubRepo}:environment:production`,
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

  /**
   * A Lambda behind a function URL that only CloudFront may call, logging to its own log group. Its role may only
   * write there (an inline policy, not AWSLambdaBasicExecutionRole).
   */
  private counter(id: string, description: string, entry: string, retention: logs.RetentionDays) {
    const logGroup = new logs.LogGroup(this, `${id}Logs`, { retention, removalPolicy: RemovalPolicy.RETAIN });
    const role = new iam.Role(this, `${id}Role`, {
      description: `${description}: writes its log lines`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });
    logGroup.grantWrite(role);
    const fn = new lambda.Function(this, id, {
      role,
      description,
      code: lambda.Code.fromInline(bundle(entry)),
      handler: 'index.handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 128,
      timeout: Duration.seconds(3),
      logGroup,
    });
    return { logGroup, url: fn.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.AWS_IAM }) };
  }

  /**
   * Daily counts per event, and the breakdowns (tools, report copies, landing pages) from the log lines.
   * Below them, our own policy's violations: the alarm, the counts, and what was blocked where.
   */
  private usageDashboard(logGroup: logs.ILogGroup, violationLogs: logs.ILogGroup) {
    const count = (event: string) =>
      new cloudwatch.Metric({
        namespace: USAGE_NAMESPACE,
        metricName: 'Count',
        dimensionsMap: { Event: event },
        statistic: cloudwatch.Stats.SUM,
        period: Duration.days(1),
        label: event,
      });
    const events = Object.keys(USAGE_EVENTS);
    const usage = events.filter((e) => e !== 'visit');
    const table = (title: string, query: string, group = logGroup, width = 8) =>
      new cloudwatch.LogQueryWidget({
        title,
        logGroupNames: [group.logGroupName],
        view: cloudwatch.LogQueryVisualizationType.TABLE,
        queryLines: [query],
        width,
        height: 8,
      });

    // Violations of our own policy, by kind. Our pages trigger none (the e2e suite fails on any), so a single
    // script one is worth a look. No notification: the alarm stays in ALARM for a day after the last one, on the
    // dashboard and in the CloudWatch console.
    const violationCount = (kind: string, period = Duration.days(1)) =>
      new cloudwatch.Metric({
        namespace: VIOLATION_NAMESPACE,
        metricName: 'Violations',
        dimensionsMap: { Kind: kind },
        statistic: cloudwatch.Stats.SUM,
        period,
        label: kind,
      });
    const scriptAlarm = new cloudwatch.Alarm(this, 'ScriptViolationsAlarm', {
      alarmName: 'CspExplained-ScriptViolations',
      alarmDescription: "Something tried to run code that this site's policy blocked, in the last 24 hours. See the CSP violations tables on the CspExplained-Usage dashboard.",
      metric: violationCount('script', Duration.hours(1)),
      threshold: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: 24,
      datapointsToAlarm: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      actionsEnabled: false,
    });

    new cloudwatch.Dashboard(this, 'UsageDashboard', {
      dashboardName: 'CspExplained-Usage',
      defaultInterval: Duration.days(30),
      widgets: [
        [
          new cloudwatch.SingleValueWidget({
            title: 'Totals over the selected period',
            metrics: events.map((e) => count(e)),
            setPeriodToTimeRange: true,
            width: 24,
            height: 4,
          }),
        ],
        [
          new cloudwatch.GraphWidget({ title: 'Visits per day', left: [count('visit')], width: 12, height: 8 }),
          new cloudwatch.GraphWidget({ title: 'Usage per day', left: usage.map((e) => count(e)), width: 12, height: 8 }),
        ],
        [
          table('Tools added', 'filter Event = "tool" | stats count(*) as times by tool | sort times desc'),
          table('Reports copied', 'filter Event = "copy-report" | stats count(*) as times by audience, kind | sort times desc'),
          table('Visits by landing page', 'filter Event = "visit" | stats count(*) as visits by page | sort visits desc'),
        ],
        [
          new cloudwatch.AlarmStatusWidget({ title: 'Blocked code on this site', alarms: [scriptAlarm], width: 6, height: 8 }),
          new cloudwatch.GraphWidget({
            title: "Violations of this site's policy per day",
            left: [violationCount('script'), violationCount('other')],
            width: 18,
            height: 8,
          }),
        ],
        [
          table(
            'What was blocked',
            'stats count(*) as times, latest(@timestamp) as last by Kind, Directive, Blocked | sort times desc',
            violationLogs,
            12,
          ),
          table('Where', 'stats count(*) as times by Page, Source, Line | sort times desc', violationLogs, 12),
        ],
      ],
    });
  }
}
