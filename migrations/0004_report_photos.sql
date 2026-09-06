-- Report attachments remain private in the existing PRODUCT_IMAGES R2 bucket.
ALTER TABLE reports ADD COLUMN photo_key TEXT;
