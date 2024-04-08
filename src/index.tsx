import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

type Bindings = {
  BUCKET: R2Bucket;
  BUCKET_PUBLIC_URL: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app
  .get(
    '/',
    zValidator(
      'query',
      z.object({
        image: z.string().optional(),
      }),
    ),
    (c) => {
      const { image: imageId } = c.req.valid('query');

      return c.html(
        <main>
          <form action='/image' method='POST' enctype='multipart/form-data'>
            <input type='file' name='image' />
            <button type='submit'>Upload</button>
          </form>

          {imageId !== undefined && (
            <img
              style='max-width: calc(100vw - 80px); padding: 12px; margin-inline: 20px; box-shadow: 0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1);'
              src={`/image/${imageId}`}
              alt=''
            />
          )}
        </main>,
      );
    },
  )
  .post(
    '/image',
    zValidator(
      'form',
      z.object({
        image: z.instanceof(File),
      }),
    ),
    async (c) => {
      const { image } = c.req.valid('form');
      const id = crypto.randomUUID();
      const result = await c.env.BUCKET.put(id, image, {
        httpMetadata: {
          contentType: image.type,
        },
        customMetadata: {
          lastModified: new Date(image.lastModified).toISOString(),
        },
      });
      if (result === null) {
        return c.json({ error: 'Failed to upload image' }, 500);
      }

      return c.redirect(`/?image=${id}`);
    },
  )
  .get('/image/:id', async (c) => {
    const cacheKey = new Request(c.req.url, c.req.raw);
    const cache = caches.default;
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse !== undefined) {
      return cachedResponse;
    }

    const id = c.req.param('id');
    const image = await c.env.BUCKET.get(id);
    if (image === null) {
      return c.json({ error: 'Image not found' }, 404);
    }

    const headers = new Headers();
    headers.append(
      'Content-Type',
      image.httpMetadata?.contentType ?? 'application/octet-stream',
    );
    headers.append('Cache-Control', 'public, max-age=31536000, immutable');
    if (image.customMetadata?.lastModified) {
      headers.append('Last-Modified', image.customMetadata.lastModified);
    }

    return c.newResponse(image.body, { headers });
  });

export default app;
