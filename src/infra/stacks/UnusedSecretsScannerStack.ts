import {Duration, Stack, StackProps} from 'aws-cdk-lib'
import { Runtime} from 'aws-cdk-lib/aws-lambda'
import { Construct } from 'constructs'
import { join } from 'path'
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs"
import * as cdk from 'aws-cdk-lib'
import * as events from 'aws-cdk-lib/aws-events'
import * as targets from 'aws-cdk-lib/aws-events-targets'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as ssm from 'aws-cdk-lib/aws-ssm'


export class UnusedSecretsScannerStack extends Stack {

    constructor(scope: Construct, id: string, props?: StackProps) {
        super(scope, id, props)

        // Create lifecycle rule for S3 bucket to delete objects after 14 days
        const lifecycleRule = {
            id: 'DeleteObjectsAfter14Days',
            expiration: Duration.days(14),
            enabled: true,
        }

        // Create an S3 bucket
        const bucket = new s3.Bucket(this, 'UnusedSecretsBucket', {
            versioned: true,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
            lifecycleRules: [lifecycleRule]
        })

        // Create a parameter in SSM Parameter Store to store the list of suppressed secrets
        const suppressedSecretsParameter = new ssm.StringListParameter(this, 'SuppressedSecretsParameter', {
            parameterName: '/unusedSecretsScanner/suppressedSecrets',
            stringListValue: ['my-secret-name', 'my-other-secret-name'],
            description: 'List of secrets to be suppressed from the Unused Secrets Scanner',
        })

        // Create the Lambda function
        const checkUnusedSecretsLambda = new NodejsFunction(this, 'UnusedSecretsScannerLambda', {
            runtime: Runtime.NODEJS_18_X,
            handler: 'handler',
            entry: join(__dirname, '..','..', 'services', 'SecretsScannerLambdaHandler.ts'),
            timeout: Duration.minutes(5),
            memorySize: 256,
            environment: {
                UnusedDays: '90',
                DeleteUnusedSecrets: 'false',
                BucketName: bucket.bucketName,
                SuppressedSecretsParameter: suppressedSecretsParameter.parameterName,
            },
        })

        // Grant the Lambda function permissions to access AWS Secrets Manager
        checkUnusedSecretsLambda.addToRolePolicy(new iam.PolicyStatement({
            actions: ['secretsmanager:ListSecrets', 'ssm:GetParameter'],
            resources: ['*'],
        }))

        // Grant the Lambda function permissions to write to the S3 bucket
        bucket.grantWrite(checkUnusedSecretsLambda)

        // Create EventBridge rule to trigger the Lambda function every Monday at 1 PM Melbourne Time (AEST/AEDT)
        new events.Rule(this, 'WeeklyLambdaTrigger', {
            schedule: events.Schedule.cron({ minute: '0', hour: '3', weekDay: 'MON' }),
            targets: [new targets.LambdaFunction(checkUnusedSecretsLambda)],
        })
    }
}


