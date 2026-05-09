.PHONY: docker-up docker-down docker-logs

docker-up:
	docker-compose pull
	docker-compose up -d

docker-down:
	docker-compose down

docker-logs:
	docker-compose logs -f
