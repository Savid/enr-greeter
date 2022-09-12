# enr-greeter

```bash
docker run -d --name enr-greeter \
  -e "REMOTE_GET_ENDPOINT=https://somewhere.example.com/enrs" \
  -e "REMOTE_SEND_ENDPOINT=https://somewhere.example.com/eth_statuses" \
  -e "SHARED_SECRET=abc123" \
  savid/enr-greeter:latest
```
