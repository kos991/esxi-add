.PHONY: up down logs image save test

IMAGE ?= esxi-iso-builder:local
VERSION := $(shell cat VERSION)

up:
	docker compose up -d

down:
	docker compose down

logs:
	docker compose logs -f

image:
	docker build -t $(IMAGE) --build-arg APP_VERSION=$(VERSION) .

save: image
	docker save $(IMAGE) | gzip > esxi-iso-builder.tar.gz

test:
	go test ./...
	cd frontend && npm test
