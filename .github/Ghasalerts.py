import requests
import json
from datetime import datetime
from datetime import date

url='https://github.com/AAInternal/kr_publictest/dependabot/alerts?state=open&page=1&per_page=100'
header = { "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"}
response=requests.get(url,headers=header)
print(response.text)


