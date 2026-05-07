# azure-image-2
1. 使用 API 密钥进行身份验证
对于无服务器 API 终结点，请部署模型来生成终结点 URL 和 API 密钥，以针对服务进行身份验证。在此示例中，终结点和密钥是包含终结点 URL 和 API 密钥的字符串。 部署模型后，可以在“部署 + 终结点”页面查找 API 终结点 URL 和 API 密钥。

如果使用的是 bash:

`export AZURE_API_KEY="<your-api-key>"`

如果使用的是 powershell:

`$Env:AZURE_API_KEY = "<your-api-key>"`

如果使用的是 Windows 命令提示符:

`set AZURE_API_KEY = <your-api-key>`

2. 运行基本代码示例
要生成图像，请将以下内容粘贴到 shell 中

```shell
curl -X POST "https://<your-resource-name>.cognitiveservices.azure.com/openai/deployments/gpt-image-2/images/generations?api-version=2024-02-01" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AZURE_API_KEY" \
  -d '{
     "prompt" : "A photograph of a red fox in an autumn forest",
     "size" : "1024x1024",
     "quality" : "low",
     "output_compression" : 100,
     "output_format" : "png",
     "n" : 1
    }' | jq -r '.data[0].b64_json' | base64 --decode > generated_image.png
```

要编辑图像，请将以下内容粘贴到 shell 中
```shell
curl -X POST "https://<your-resource-name>.cognitiveservices.azure.com/openai/deployments/gpt-image-2/images/edits?api-version=2024-02-01" \
  -H "Authorization: Bearer $AZURE_API_KEY" \
  -F "image=@image_to_edit.png" \
  -F "mask=@mask.png" \
  -F "prompt=Make this black and white"  | jq -r '.data[0].b64_json' | base64 --decode > edited_image.png

```