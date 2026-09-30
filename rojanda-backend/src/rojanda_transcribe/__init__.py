"""RojAnda transcription backend (isolated rojanda-transcribe stack).

Turkish (tr-TR) speech-to-text via Amazon Transcribe (batch), fronted by an
IAM-authed HTTP API. No AWS credentials in the client; per-user isolation is
enforced from the verified Cognito identity + server-generated S3 keys.
"""
