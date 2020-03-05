# **Visual Definition Example**

![visial task definition](./images/example.png)

# Test in practice

```bash
R=`echo $((1 + RANDOM % 10))`
echo $R
if [ $R -gt 5 ]; then
  exit 1
fi
```

## Task configuration:

![visial task definition](./images/rerunExample.png)

## Output example:

![output example](./images/rerunLogsExample.png)