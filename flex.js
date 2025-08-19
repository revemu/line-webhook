const report_template = {
                "type": "bubble",
                hero: {
                    type: 'image',
                    url: '{{img_url}}',
                    size: 'full',
                    aspectRatio: '20:13',
                    aspectMode: 'cover'
                },
                "body": {
                "type": "box",
                "layout": "vertical",
                "contents": [
                    {
                    "type": "text",
                    "text": "{{content}}",
                    "weight": "bold",
                    "size": "xl"
                    },
                    {
                    "type": "text",
                    "text": "{{text}}",
                    "margin": "md"
                    }
                ]
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