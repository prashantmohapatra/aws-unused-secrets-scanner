import {SecretsManager, S3, SSM} from 'aws-sdk'
import {Context, Callback} from 'aws-lambda'
import {createObjectCsvWriter} from 'csv-writer'
import {SecretListEntry} from "aws-sdk/clients/secretsmanager"
import * as fs from 'fs'

const secretsManager = new SecretsManager()
const s3 = new S3()
const ssm = new SSM()
const maxUnusedDays = parseInt(process.env.UnusedDays || '90', 10)
const bucketName = process.env.BucketName || ''
const suppressedSecretsParameterName = process.env.SuppressedSecretsParameter || ''
const deleteUnusedSecrets = process.env.DeleteUnusedSecrets === 'true'


interface ExtendedSecret extends SecretListEntry {
    Name: string
    LastAccessedDate?: Date
    DaysUnused?: number
}

// Handler
export const handler = async (event: any, context: Context, callback: Callback): Promise<void> => {
    try {
        const unusedSecrets = await getUnusedSecrets()

        console.log('Unused Secrets:', unusedSecrets)

        if (unusedSecrets.length > 0) {
            await uploadToS3(unusedSecrets)
            // TODO: Enable the code below to delete unused secrets
            // if (deleteUnusedSecrets) {
            //     await deleteSecrets(unusedSecrets)
            // }
        }

        callback(null, unusedSecrets)
    } catch (error) {
        console.error('Error fetching unused secrets:', error)
        callback(error)
    }
}

// Get unused secrets
const getUnusedSecrets = async (): Promise<ExtendedSecret[]> => {
    const secrets: ExtendedSecret[] = []
    const suppressedSecrets = await getSuppressedSecrets()
    let nextToken: string | undefined

    do {
        const secretResponse = await secretsManager.listSecrets({NextToken: nextToken}).promise()
        // console.log('listAllSecrets - secretResponse:', secretResponse)

        for (const secret of secretResponse.SecretList || []) {
            const daysUnused = getDaysUnused(secret)
            if (daysUnused !== null && daysUnused >= maxUnusedDays && !suppressedSecrets.includes(secret.Name)) {
                secrets.push({ Name: secret.Name, LastAccessedDate: secret.LastAccessedDate, DaysUnused: daysUnused } as ExtendedSecret)
            }
            nextToken = secretResponse.NextToken
        }
    } while (nextToken)

    return secrets
}

// Delete secrets
const deleteSecrets = async (secrets: ExtendedSecret[]): Promise<void> => {
    for (const secret of secrets) {
        try {
            await secretsManager.deleteSecret({
                SecretId: secret.Name,
                ForceDeleteWithoutRecovery: true
            }).promise()
            console.log(`Deleted secret: ${secret.Name}`)
        } catch (error) {
            console.error(`Error deleting secret ${secret.Name}:`, error)
        }
    }
}

const getDaysUnused = (secret: SecretListEntry): number | null => {
    if (!secret.LastAccessedDate) return null
    const now = new Date()
    const diffTime = Math.abs(now.getTime() - secret.LastAccessedDate.getTime())
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24))
}

const getSuppressedSecrets = async (): Promise<string[]> => {
    const response = await ssm.getParameter({
        Name: suppressedSecretsParameterName,
        WithDecryption: true,
    }).promise()
    return String(response.Parameter?.Value || '').split(',')
}

const uploadToS3 = async (unusedSecrets: ExtendedSecret[]): Promise<void> => {
    const csvWriter = createObjectCsvWriter({
        path: `/tmp/unused-secrets.csv`,
        header: [
            {id: 'Name', title: 'Name'},
            {id: 'LastAccessedDate', title: 'LastAccessedDate'},
            {id: 'DaysUnused', title: 'DaysUnused'},
        ],
    })

    await csvWriter.writeRecords(unusedSecrets.map(secret => ({
        Name: secret.Name,
        LastAccessedDate: secret.LastAccessedDate ? secret.LastAccessedDate.toISOString() : 'N/A',
        DaysUnused: secret.DaysUnused?.toString() || 'N/A',
    })))

    const csvData = fs.readFileSync('/tmp/unused-secrets.csv')

    const params = {
        Bucket: bucketName,
        Key: `unused-secrets-${new Date().toISOString()}.csv`,
        Body: csvData,
        ContentType: 'text/csv',
    }

    await s3.putObject(params).promise()
}
