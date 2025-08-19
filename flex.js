const report_template = {  
    "type": "flex",
    "altText": "Test",
    "contents": {
        "type": "bubble",
        "hero": {
            "type": "image",
            "url": "{{img_url}}",
            "size": "full",
            "aspectRatio": "21:18",
            "aspectMode": "cover"
        },
        "body": {
                "type": "box",
                "layout": "vertical",
                "spacing": "xs",
                "contents": [
                    {
                        "type": "text",
                        "text": "{{header}}",
                        "weight": "bold",
                        "size": "md",
                        "align": "start"
                    },
                    {
                        "type": "text",
                        "text": "{{content}}",
                        "weight": "bold",
                        "size": "md",
                        "align": "start"
                    }			 
                ]
        }
									
    }
}

const flexTemplate = {
  type: 'flex',
  altText: 'Product Information',
  contents: {
    type: 'bubble',
    hero: {
      type: 'image',
      url: '{{PRODUCT_IMAGE}}',
      size: 'full',
      aspectRatio: '20:13',
      aspectMode: 'cover'
    },
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'text',
          text: '{{PRODUCT_NAME}}',
          weight: 'bold',
          size: 'xl'
        },
        {
          type: 'box',
          layout: 'vertical',
          margin: 'lg',
          spacing: 'sm',
          contents: [
            {
              type: 'box',
              layout: 'baseline',
              spacing: 'sm',
              contents: [
                {
                  type: 'text',
                  text: 'Price',
                  color: '#aaaaaa',
                  size: 'sm',
                  flex: 1
                },
                {
                  type: 'text',
                  text: '{{PRICE}}',
                  wrap: true,
                  color: '#666666',
                  size: 'sm',
                  flex: 5
                }
              ]
            },
            {
              type: 'box',
              layout: 'baseline',
              spacing: 'sm',
              contents: [
                {
                  type: 'text',
                  text: 'Category',
                  color: '#aaaaaa',
                  size: 'sm',
                  flex: 1
                },
                {
                  type: 'text',
                  text: '{{CATEGORY}}',
                  wrap: true,
                  color: '#666666',
                  size: 'sm',
                  flex: 5
                }
              ]
            },
            {
              type: 'box',
              layout: 'baseline',
              spacing: 'sm',
              contents: [
                {
                  type: 'text',
                  text: 'Rating',
                  color: '#aaaaaa',
                  size: 'sm',
                  flex: 1
                },
                {
                  type: 'text',
                  text: '{{RATING}} ⭐',
                  wrap: true,
                  color: '#666666',
                  size: 'sm',
                  flex: 5
                }
              ]
            }
          ]
        },
        {
          type: 'text',
          text: '{{DESCRIPTION}}',
          wrap: true,
          color: '#666666',
          size: 'sm',
          margin: 'lg'
        }
      ]
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: [
        {
          type: 'button',
          style: 'primary',
          height: 'sm',
        },
        {
          type: 'spacer',
          size: 'sm'
        }
      ],
      flex: 0
    }
  }
};

function replacePlaceholders(template, data) {
  let jsonString = JSON.stringify(template);
  
  // Replace all placeholders with actual data
  Object.keys(data).forEach(key => {
    const placeholder = `{{${key}}}`;
    const regex = new RegExp(placeholder, 'g');
    jsonString = jsonString.replace(regex, data[key]);
  });
  
  return JSON.parse(jsonString);
}

module.exports = {
  report_template,
  flexTemplate,
  replacePlaceholders,
};