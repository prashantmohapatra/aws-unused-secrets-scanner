import { App } from "aws-cdk-lib"
import {UnusedSecretsScannerStack} from "./stacks/UnusedSecretsScannerStack"

const app = new App()
new UnusedSecretsScannerStack(app, 'UnusedSecretsScannerStack')