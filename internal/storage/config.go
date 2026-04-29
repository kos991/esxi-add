package storage

type S3Config struct {
    Endpoint        string
    AccessKeyID     string
    SecretAccessKey string
    BucketName      string
    Region          string
    UseSSL          bool
    PublicDomain    string // used to generate public download URLs
}
