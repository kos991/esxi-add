.PHONY: build run test clean deps docker-build docker-up docker-down docker-logs docker-dev

build:
	go build -o bin/server ./cmd/server

run:
	go run ./cmd/server

test:
	go test ./...

clean:
	go clean
	powershell -Command "if (Test-Path 'bin') { Remove-Item -Recurse -Force 'bin' }"

deps:
	go mod download
	go mod tidy

docker-build:
	docker-compose build

docker-up:
	docker-compose up -d

docker-down:
	docker-compose down

docker-logs:
	docker-compose logs -f

docker-dev:
	docker-compose -f docker-compose.yml -f docker-compose.dev.yml up
