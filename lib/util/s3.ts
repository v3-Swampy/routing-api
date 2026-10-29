import S3 from 'aws-sdk/clients/s3'

// Reuse one S3 client per Lambda container. Creating a client per chain and
// protocol prevents the SDK from pooling TCP/TLS connections during the cache
// reads that happen before a container can serve its first quote.
export const s3Client = new S3()
