package storage

import "testing"

func TestNormalizeS3EndpointAcceptsCloudflareR2URL(t *testing.T) {
	endpoint, useSSL, err := normalizeS3Endpoint("https://accountid.r2.cloudflarestorage.com", false)
	if err != nil {
		t.Fatalf("normalize endpoint: %v", err)
	}

	if endpoint != "accountid.r2.cloudflarestorage.com" {
		t.Fatalf("expected host-only endpoint, got %q", endpoint)
	}
	if !useSSL {
		t.Fatal("expected https endpoint to enable SSL")
	}
}

func TestNormalizeS3EndpointAcceptsHTTPMinIOURL(t *testing.T) {
	endpoint, useSSL, err := normalizeS3Endpoint("http://127.0.0.1:9000/", true)
	if err != nil {
		t.Fatalf("normalize endpoint: %v", err)
	}

	if endpoint != "127.0.0.1:9000" {
		t.Fatalf("expected host-only endpoint, got %q", endpoint)
	}
	if useSSL {
		t.Fatal("expected http endpoint to disable SSL")
	}
}

func TestNormalizeS3EndpointRejectsPath(t *testing.T) {
	if _, _, err := normalizeS3Endpoint("https://accountid.r2.cloudflarestorage.com/esxi-build", true); err == nil {
		t.Fatal("expected endpoint with path to be rejected")
	}
}

func TestNormalizeS3EndpointKeepsHostPort(t *testing.T) {
	endpoint, useSSL, err := normalizeS3Endpoint("minio:9000", false)
	if err != nil {
		t.Fatalf("normalize endpoint: %v", err)
	}

	if endpoint != "minio:9000" {
		t.Fatalf("expected endpoint to stay unchanged, got %q", endpoint)
	}
	if useSSL {
		t.Fatal("expected explicit SSL flag to stay false")
	}
}

func TestS3ClientGetPublicURLUsesObjectPathWithoutBucketName(t *testing.T) {
	client := &S3Client{
		bucketName:   "esxi-build",
		publicDomain: "https://driver.wwa.im/",
	}

	got := client.GetPublicURL("/output/65test.iso")
	want := "https://driver.wwa.im/output/65test.iso"
	if got != want {
		t.Fatalf("expected public URL %q, got %q", want, got)
	}
}
