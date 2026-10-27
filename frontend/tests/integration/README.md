# Integration tests

Run the real API routes against a **throwaway local Postgres**. The setup drops and
recreates the `public` schema, so it refuses to run unless the database is on
localhost and its name ends in `_test`.

```bash
createdb -h 127.0.0.1 -p 5432 -U postgres bytes_test   # once
DB_HOST=127.0.0.1 DB_PORT=5432 DB_NAME=bytes_test DB_USER=postgres DB_PASSWORD=postgres DB_SSL=false \
  npm run test:integration
```
