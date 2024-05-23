import {SecretsManager, S3} from 'aws-sdk'
import {Context, Callback} from 'aws-lambda'
import {createObjectCsvWriter} from 'csv-writer'
import {SecretListEntry} from "aws-sdk/clients/secretsmanager"
import * as fs from 'fs'

const secretsManager = new SecretsManager()
const s3 = new S3()
const maxUnusedDays = parseInt(process.env.UnusedDays || '90', 10)
const bucketName = process.env.BucketName || ''

interface ExtendedSecret extends SecretListEntry {
    Name: string
    LastAccessedDate?: Date
    DaysUnused?: number
}

export const handler = async (event: any, context: Context, callback: Callback): Promise<void> => {
    try {
        //const secrets = await listAllSecrets()
        const unusedSecrets = await getUnusedSecrets()

        console.log('Unused Secrets:', unusedSecrets)

        if (unusedSecrets.length > 0) {
            await uploadToS3(unusedSecrets)
        }

        callback(null, unusedSecrets)
    } catch (error) {
        console.error('Error fetching unused secrets:', error)
        callback(error)
    }
}

const getUnusedSecrets = async (): Promise<ExtendedSecret[]> => {
    const secrets: ExtendedSecret[] = []


    let nextToken: string | undefined

    do {
        const secretResponse = await secretsManager.listSecrets({NextToken: nextToken}).promise()
        // console.log('listAllSecrets - secretResponse:', secretResponse)

        for (const secret of secretResponse.SecretList || []) {
            const daysUnused = getDaysUnused(secret)
            if (daysUnused !== null && daysUnused >= maxUnusedDays) {
                secrets.push({ Name: secret.Name, LastAccessedDate: secret.LastAccessedDate, DaysUnused: daysUnused } as ExtendedSecret)
            }
            nextToken = secretResponse.NextToken
        }
    } while (nextToken)

    return secrets
}

const getDaysUnused = (secret: SecretListEntry): number | null => {
    if (!secret.LastAccessedDate) return null
    const now = new Date()
    const diffTime = Math.abs(now.getTime() - secret.LastAccessedDate.getTime())
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24))
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
