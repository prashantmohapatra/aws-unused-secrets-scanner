import { Stack, StackProps } from 'aws-cdk-lib'
import { Runtime} from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { join } from 'path';
import {NodejsFunction} from "aws-cdk-lib/aws-lambda-nodejs";


export class LambdaStack extends Stack {

    constructor(scope: Construct, id: string, props?: StackProps) {
        super(scope, id, props)


        new NodejsFunction(this, 'HelloLambda', {
            runtime: Runtime.NODEJS_18_X,
            handler: 'handler',
            entry: join(__dirname, '..','..', 'services', 'hello.ts')
        })

    }
}